-- DRAFT PHASE 1: queue + owner RPC. Adapter, Edge enrol, schema validators dan UI masih build Fable.
-- Menjalankan SQL saja tidak membangun sistem. Uji terhadap live schema probe dahulu.
begin;
create function lab_private.worker_id() returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid;
begin
 select id into w from lab_private.workers where auth_user_id=auth.uid() and enabled;
 if w is null then raise exception 'worker_disabled' using errcode='42501'; end if;
 return w;
end $$;
create function lab_private.lock_job(p_job uuid,p_attempt integer,p_lease uuid)
returns public.os_lab_hermes_jobs language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; w uuid:=lab_private.worker_id();
begin
 select * into j from public.os_lab_hermes_jobs where id=p_job for update;
 if not found or j.worker_id is distinct from w or j.attempt is distinct from p_attempt
 or j.lease_token is distinct from p_lease or j.lease_until<=clock_timestamp()
 or j.status not in ('running','validating','cancel_requested') then
  raise exception 'lease_lost' using errcode='42501'; end if;
 return j;
end $$;
create function lab_private.refresh_usage(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.os_lab_runs r set cost_usd=u.cost,tokens_in=u.tin,tokens_out=u.tout
 from (select a.run_id,sum(l.actual_usd) cost,sum((l.usage->>'input_tokens')::int) tin,sum((l.usage->>'output_tokens')::int) tout
 from public.os_lab_hermes_attempts a left join lab_private.usage_ledger l on l.job_id=a.job_id and l.attempt=a.attempt
 where a.job_id=p_job group by a.run_id) u where r.id=u.run_id;
 update public.os_inst_briefs b set cost_actual_usd=u.cost,tokens_actual=u.tokens
 from (select j.brief_id,coalesce(sum(l.actual_usd),0) cost,
 coalesce(sum(coalesce((l.usage->>'input_tokens')::bigint,0)+coalesce((l.usage->>'output_tokens')::bigint,0)),0) tokens
 from public.os_lab_hermes_jobs j left join lab_private.usage_ledger l on l.job_id=j.id
 where j.brief_id=(select brief_id from public.os_lab_hermes_jobs where id=p_job) group by j.brief_id) u
 where b.id=u.brief_id;
end $$;
create function public.lab_worker_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=lab_private.worker_id(); j public.os_lab_hermes_jobs; r uuid; p uuid; expired record;
begin
 perform pg_advisory_xact_lock(7192601);
 -- Reap, termasuk cancel; DB clock, bukan timestamp yang dikirim worker.
 for expired in select * from public.os_lab_hermes_jobs where status in ('running','validating','cancel_requested')
 and lease_until<=clock_timestamp() for update loop
  update public.os_lab_runs set status='error',error='lease_expired' where id=expired.run_id;
  update public.os_lab_hermes_attempts set status='lease_expired',finished_at=now()
   where job_id=expired.id and attempt=expired.attempt;
  update public.os_lab_hermes_jobs set status=case when expired.status='cancel_requested' then 'cancelled'
   when expired.attempt>=3 then 'failed' else 'retry_wait' end,
   available_at=now()+case when expired.attempt=1 then interval '10 seconds' else interval '30 seconds' end,
   finished_at=case when expired.status='cancel_requested' or expired.attempt>=3 then now() else null end,
   lease_until=null,error=jsonb_build_object('code','lease_expired') where id=expired.id;
  if expired.status='cancel_requested' or expired.attempt>=3 then
   update public.os_inst_assignments set status='failed',finished_at=now() where id=expired.assignment_id;
   if expired.mode='direct' then
    update public.os_inst_briefs set status=case when expired.status='cancel_requested' then 'paused' else 'failed' end,
    finished_at=now() where id=expired.brief_id;
   end if;
  end if;
 end loop;
 if (select paused from lab_private.settings) then return null; end if;
 if exists(select 1 from public.os_lab_hermes_jobs where status in ('running','validating','cancel_requested')) then return null; end if;
 if (select enforce_daily from lab_private.settings) and
  (select coalesce(sum(coalesce(actual_usd,reserved_usd)),0) from lab_private.usage_ledger
   where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' or actual_usd is null)
  >= (select daily_limit_usd from lab_private.settings) then return null; end if;
 select * into j from public.os_lab_hermes_jobs where status in ('queued','retry_wait') and available_at<=now()
 order by greatest(0,(case weight_class when 'brief' then 0 when 'standard' then 1 else 2 end)
 - floor(extract(epoch from (now()-created_at))/300)::integer),created_at,id
 for update skip locked limit 1;
 if not found then return null; end if;
 if j.deadline_at is not null and j.deadline_at<=clock_timestamp() then
  update public.os_lab_hermes_jobs set status='timed_out',finished_at=now() where id=j.id;
  update public.os_inst_assignments set status='failed',finished_at=now() where id=j.assignment_id;
  if j.mode='direct' then update public.os_inst_briefs set status='failed',finished_at=now() where id=j.brief_id; end if;
  return null;
 end if;
 select id into p from public.os_lab_providers where name=j.payload#>>'{config,provider}';
 if p is null then raise exception 'provider_row_missing'; end if;
 insert into public.os_lab_runs(agent_id,provider_id,input,status,model)
 values(j.agent_id,p,j.payload#>>'{input,question}','running',j.payload#>>'{config,model}') returning id into r;
 update public.os_lab_hermes_jobs set status='running',attempt=attempt+1,worker_id=w,
 lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',
 claimed_at=coalesce(claimed_at,now()),attempt_started_at=now(),deadline_at=coalesce(deadline_at,now()+make_interval(secs=>timeout_seconds)),run_id=r
 where id=j.id returning * into j;
 insert into public.os_lab_hermes_attempts(job_id,attempt,worker_id,lease_token,run_id,status)
 values(j.id,j.attempt,w,j.lease_token,r,'running');
 update public.os_inst_assignments set status='working',run_id=r,started_at=coalesce(started_at,now()) where id=j.assignment_id;
 return to_jsonb(j);
end $$;
create function public.lab_worker_heartbeat(p_job uuid default null,p_attempt integer default null,p_lease uuid default null,
 p_runtime_sha text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=lab_private.worker_id(); j public.os_lab_hermes_jobs;
begin
 update lab_private.workers set last_seen_at=now(),runtime_sha=p_runtime_sha where id=w;
 insert into public.os_lab_worker_status(worker_id,name,last_seen_at,runtime_sha,active_job_id)
 select w,name,now(),p_runtime_sha,p_job from lab_private.workers where id=w
 on conflict(worker_id) do update set last_seen_at=excluded.last_seen_at,runtime_sha=excluded.runtime_sha,active_job_id=excluded.active_job_id;
 if p_job is not null then
  j:=lab_private.lock_job(p_job,p_attempt,p_lease);
  if clock_timestamp()>=j.deadline_at then
   return jsonb_build_object('command','timeout','db_now',clock_timestamp()); end if;
  update public.os_lab_hermes_jobs set lease_until=clock_timestamp()+interval '60 seconds' where id=p_job;
  if j.status='cancel_requested' or (select paused from lab_private.settings) then
   return jsonb_build_object('command','cancel','db_now',clock_timestamp()); end if;
 end if;
 return jsonb_build_object('command','continue','db_now',clock_timestamp());
end $$;
create function public.lab_owner_cancel(p_job uuid) returns text language plpgsql security definer set search_path='' as $$
declare s text;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 select status into s from public.os_lab_hermes_jobs where id=p_job for update;
 if s in ('queued','retry_wait') then
  update public.os_lab_hermes_jobs set status='cancelled',finished_at=now() where id=p_job;
  update public.os_inst_assignments set status='failed',finished_at=now() where id=(select assignment_id from public.os_lab_hermes_jobs where id=p_job);
  update public.os_inst_briefs set status='paused',finished_at=now() where id=(select brief_id from public.os_lab_hermes_jobs where id=p_job and mode='direct');
  return 'cancelled';
 elsif s in ('running','validating','cancel_requested') then
  update public.os_lab_hermes_jobs set status='cancel_requested' where id=p_job;
  return 'cancel_requested';
 end if;
 return coalesce(s,'not_found');
end $$;
create function public.lab_worker_events(p_job uuid,p_attempt integer,p_lease uuid,p_events jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; e jsonb; n integer:=0;
begin
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>100 then raise exception 'events_invalid'; end if;
 for e in select * from jsonb_array_elements(p_events) loop
  if octet_length(e::text)>4096 or e->>'kind' not in
   ('job.started','tool.started','tool.finished','model.started','model.finished','usage.updated','job.warning','job.stopped','delivery.started')
  then raise exception 'event_invalid'; end if;
  insert into public.os_lab_hermes_events(job_id,attempt,sequence,kind,emitted_at,payload)
  values(p_job,p_attempt,(e->>'sequence')::bigint,e->>'kind',(e->>'emitted_at')::timestamptz,
  coalesce(e->'payload','{}')) on conflict(job_id,attempt,sequence) do nothing;
  n:=n+1;
 end loop;
 return n;
end $$;
create function public.lab_worker_reserve(p_job uuid,p_attempt integer,p_lease uuid,p_call uuid,p_route text,p_upper_usd numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; total numeric; prior lab_private.usage_ledger;
begin
 perform pg_advisory_xact_lock(7192601); j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if j.status<>'running' or (select paused from lab_private.settings) then raise exception 'spending_disabled'; end if;
 select * into prior from lab_private.usage_ledger where job_id=p_job and attempt=p_attempt and call_id=p_call;
 if found then
  if prior.route_id<>p_route or prior.reserved_usd<>p_upper_usd then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('reserved',true,'replay',true); end if;
 if p_upper_usd is null or p_upper_usd<=0 then raise exception 'reservation_invalid'; end if;
 select coalesce(sum(coalesce(actual_usd,reserved_usd)),0) into total from lab_private.usage_ledger where job_id=p_job;
 if total+p_upper_usd>j.max_cost_usd then raise exception 'budget_exceeded'; end if;
 if (select enforce_daily from lab_private.settings) and
  (select coalesce(sum(coalesce(actual_usd,reserved_usd)),0) from lab_private.usage_ledger
   where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' or actual_usd is null)+p_upper_usd
  > (select daily_limit_usd from lab_private.settings) then raise exception 'daily_budget_exceeded'; end if;
 insert into lab_private.usage_ledger(job_id,attempt,call_id,route_id,reserved_usd) values(p_job,p_attempt,p_call,p_route,p_upper_usd);
 return jsonb_build_object('reserved',true,'replay',false);
end $$;
create function public.lab_worker_settle(p_job uuid,p_attempt integer,p_lease uuid,p_call uuid,p_actual_usd numeric,p_usage jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare w uuid:=lab_private.worker_id(); l lab_private.usage_ledger;
begin
 -- Late settlement diizinkan untuk attempt milik worker ini; bukan hak mengirim final lama.
 if not exists(select 1 from public.os_lab_hermes_attempts where job_id=p_job and attempt=p_attempt
  and worker_id=w and lease_token=p_lease) then raise exception 'attempt_forbidden' using errcode='42501'; end if;
 select * into l from lab_private.usage_ledger where job_id=p_job and attempt=p_attempt and call_id=p_call for update;
 if not found then raise exception 'reservation_missing'; end if;
 if p_actual_usd is null or p_actual_usd<0 then raise exception 'usage_unknown_keep_reservation'; end if;
 if l.actual_usd is not null then
  if l.actual_usd<>p_actual_usd or l.usage is distinct from p_usage then raise exception 'idempotency_conflict'; end if;
  return; end if;
 -- Jangan truncate actual ke cap. Overrun menunjukkan bug harga, harus terlihat dan menghentikan klaim.
 update lab_private.usage_ledger set actual_usd=p_actual_usd,usage=p_usage,settled_at=now()
 where job_id=p_job and attempt=p_attempt and call_id=p_call;
 if p_actual_usd>l.reserved_usd then update lab_private.settings set paused=true; end if;
 perform lab_private.refresh_usage(p_job);
end $$;
create function public.lab_worker_archive(p_job uuid,p_attempt integer,p_lease uuid,p_operation uuid,p_record jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; c uuid; h text; old lab_private.archives; parents uuid[];
begin
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if j.status<>'running' then raise exception 'archive_not_running'; end if;
 if length(coalesce(p_record->>'content',''))=0 or octet_length(p_record->>'content')>2097152 then raise exception 'content_invalid'; end if;
 h:=encode(sha256(convert_to(p_record::text,'UTF8')),'hex');
 select * into old from lab_private.archives where job_id=p_job and attempt=p_attempt and operation_id=p_operation;
 if found then if old.body_hash<>h then raise exception 'idempotency_conflict'; end if; return old.corpus_id; end if;
 if p_record->>'kind' not in ('retrieval','dataset','methodology','execution','assumption') then raise exception 'corpus_kind_forbidden'; end if;
 select coalesce(array_agg(value::uuid),'{}') into parents from jsonb_array_elements_text(coalesce(p_record->'derived_from','[]'));
 if exists(select 1 from unnest(parents) x where not exists(select 1 from public.os_inst_corpus c where c.id=x and c.brief_id=j.brief_id and c.data_class='public'
 and (coalesce(j.payload#>'{input,corpus_ids}','[]') ? x::text or exists(select 1 from lab_private.archives ar where ar.job_id=p_job and ar.attempt=p_attempt and ar.corpus_id=x)))) then raise exception 'corpus_scope'; end if;
 insert into public.os_inst_corpus(kind,title,data_class,content,content_hash,url,http_status,fetched_at,query,provenance,derived_from,
 brief_id,assignment_id,created_by_agent_id,created_by_run_id)
 values(p_record->>'kind',coalesce(p_record->>'title','Retrieval'),'public',p_record->>'content',
 encode(sha256(convert_to(p_record->>'content','UTF8')),'hex'),p_record->>'url',(p_record->>'http_status')::integer,
 (p_record->>'fetched_at')::timestamptz,p_record->>'query',coalesce(p_record->'provenance','{}'),parents,
 j.brief_id,j.assignment_id,j.agent_id,j.run_id) returning id into c;
 insert into lab_private.archives values(p_job,p_attempt,p_operation,h,c);
 return c;
end $$;
create function public.lab_worker_read_corpus(p_job uuid,p_attempt integer,p_lease uuid,p_corpus uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; c jsonb;
begin
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 -- Hanya input snapshot yang disengaja atau retrieval milik attempt ini; bukan semua brief.
 if not (coalesce(j.payload#>'{input,corpus_ids}','[]') ? p_corpus::text)
 and not exists(select 1 from lab_private.archives where job_id=p_job and attempt=p_attempt and corpus_id=p_corpus)
 then raise exception 'corpus_scope' using errcode='42501'; end if;
 select to_jsonb(t) into c from public.os_inst_corpus t where id=p_corpus and data_class='public';
 return c;
end $$;
create function public.lab_worker_validating(p_job uuid,p_attempt integer,p_lease uuid)
returns void language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs;
begin j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if j.status='cancel_requested' then raise exception 'cancel_requested'; end if;
 update public.os_lab_hermes_jobs set status='validating' where id=p_job;
end $$;
create function public.lab_worker_finish(p_job uuid,p_attempt integer,p_lease uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; w uuid:=lab_private.worker_id(); h text; c uuid; cost numeric; tin bigint; tout bigint; parents uuid[];
begin
 h:=encode(sha256(convert_to(p_result::text,'UTF8')),'hex');
 select * into j from public.os_lab_hermes_jobs where id=p_job for update;
 if j.status='succeeded' and j.worker_id=w and j.attempt=p_attempt and j.lease_token=p_lease then
  if j.result_hash<>h then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('job_id',j.id,'corpus_id',j.final_corpus_id,'replay',true); end if;
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 if j.status<>'validating' then raise exception 'not_validating'; end if;
 if coalesce(length(p_result#>>'{output,markdown}'),0)=0 then raise exception 'output_invalid'; end if;
 -- Worker schema validator mandatory; SQL enforces authority, reference scope and singular commit.
 select coalesce(array_agg((value->>'corpus_id')::uuid),'{}') into parents
 from jsonb_array_elements(coalesce(p_result->'provenance','[]'));
 if exists(select 1 from unnest(parents) x where not exists(select 1 from public.os_inst_corpus c0
  where c0.id=x and c0.brief_id=j.brief_id and c0.data_class='public'
 and (coalesce(j.payload#>'{input,corpus_ids}','[]') ? x::text or exists(select 1 from lab_private.archives ar where ar.job_id=p_job and ar.attempt=p_attempt and ar.corpus_id=x)))) then raise exception 'corpus_scope'; end if;
 select coalesce(sum(actual_usd),0),coalesce(sum((usage->>'input_tokens')::bigint),0),coalesce(sum((usage->>'output_tokens')::bigint),0)
 into cost,tin,tout from lab_private.usage_ledger where job_id=p_job;
 insert into public.os_inst_corpus(kind,title,data_class,content,content_hash,provenance,derived_from,brief_id,assignment_id,created_by_agent_id,created_by_run_id)
 values('output','Hasil Hermes','public',p_result#>>'{output,markdown}',encode(sha256(convert_to(p_result#>>'{output,markdown}','UTF8')),'hex'),
 jsonb_build_object('job_id',p_job,'attempt',p_attempt,'runtime',p_result->'runtime'),parents,j.brief_id,j.assignment_id,j.agent_id,j.run_id) returning id into c;
 update public.os_lab_runs set status='ok',output=p_result#>>'{output,markdown}',tokens_in=tin,tokens_out=tout,cost_usd=cost,
 duration_ms=floor(extract(epoch from (clock_timestamp()-j.attempt_started_at))*1000)::integer where id=j.run_id;
 update public.os_inst_assignments set status='done',output=p_result#>>'{output,markdown}',output_corpus_id=c,finished_at=now() where id=j.assignment_id;
 if j.mode='direct' then
  update public.os_inst_briefs set status='director',final_output_corpus_id=c,finished_at=now(),cost_actual_usd=cost,tokens_actual=tin+tout where id=j.brief_id;
 end if;
 update public.os_lab_hermes_jobs set status='succeeded',result=p_result,result_hash=h,final_corpus_id=c,finished_at=now(),lease_until=null where id=p_job;
 update public.os_lab_hermes_attempts set status='succeeded',finished_at=now() where job_id=p_job and attempt=p_attempt;
 perform lab_private.refresh_usage(p_job);
 return jsonb_build_object('job_id',p_job,'corpus_id',c,'replay',false);
end $$;
create function public.lab_worker_fail(p_job uuid,p_attempt integer,p_lease uuid,p_code text,p_retryable boolean,p_detail text default '')
returns text language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; s text;
begin
 j:=lab_private.lock_job(p_job,p_attempt,p_lease);
 s:=case when j.status='cancel_requested' then 'cancelled' when p_code='timeout' then 'timed_out'
  when p_code in ('budget_exceeded','daily_budget_exceeded') then 'budget_exceeded'
  when p_retryable and p_code in ('provider_429','provider_transient','runtime_crash','oom') and j.attempt<3 then 'retry_wait' else 'failed' end;
 update public.os_lab_runs set status='error',error=left(p_code||': '||p_detail,1000) where id=j.run_id;
 update public.os_lab_hermes_attempts set status=s,finished_at=now() where job_id=p_job and attempt=p_attempt;
 update public.os_lab_hermes_jobs set status=s,lease_until=null,error=jsonb_build_object('code',p_code,'detail',left(p_detail,1000)),
 available_at=now()+make_interval(secs=>(case when j.attempt=1 then 10 else 30 end)+(floor(random()*4))::integer),
 finished_at=case when s='retry_wait' then null else now() end where id=p_job;
 if s<>'retry_wait' then
  update public.os_inst_assignments set status='failed',finished_at=now() where id=j.assignment_id;
  if j.mode='direct' then update public.os_inst_briefs set status=case when s='cancelled' then 'paused' else 'failed' end,finished_at=now() where id=j.brief_id; end if;
 end if;
 perform lab_private.refresh_usage(p_job);
 return s;
end $$;

create function public.lab_owner_pair_begin(p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare code text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 if length(p_name) not between 1 and 60 then raise exception 'name_invalid'; end if;
 insert into lab_private.pairings(code_hash,name,expires_at)
 values(encode(sha256(convert_to(code,'UTF8')),'hex'),p_name,now()+interval '10 minutes');
 return jsonb_build_object('code',code,'expires_at',now()+interval '10 minutes');
end $$;
create function public.lab_enrol_consume(p_code text,p_auth_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare t lab_private.pairings; w uuid;
begin
 if coalesce(current_setting('role',true),'none')<>'service_role' then raise exception 'service_required' using errcode='42501'; end if;
 select * into t from lab_private.pairings where code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') for update;
 if not found or t.consumed_at is not null or t.expires_at<=now() then raise exception 'pairing_invalid'; end if;
 insert into lab_private.workers(auth_user_id,name) values(p_auth_user,t.name) returning id into w;
 insert into public.os_lab_worker_wake(auth_user_id) values(p_auth_user);
 update lab_private.pairings set consumed_at=now(),worker_id=w where code_hash=t.code_hash;
 return w;
end $$;
create function public.lab_owner_worker_revoke(p_worker uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 update lab_private.workers set enabled=false where id=p_worker;
 update public.os_lab_hermes_jobs set status='cancel_requested' where worker_id=p_worker and status in ('running','validating');
end $$;
create function public.lab_owner_settings(p_paused boolean,p_daily_limit_usd numeric default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 if p_daily_limit_usd is not null and p_daily_limit_usd<=0 then raise exception 'limit_invalid'; end if;
 update lab_private.settings set paused=p_paused,daily_limit_usd=coalesce(p_daily_limit_usd,daily_limit_usd);
 if p_paused then update public.os_lab_hermes_jobs set status='cancel_requested' where status in ('running','validating'); end if;
end $$;
create function public.lab_owner_price(p_route text,p_provider text,p_model text,p_region text,p_price jsonb,p_source text,p_checked timestamptz,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 if coalesce((p_price->>'max_context_tokens')::integer,0)<=0 or coalesce((p_price->>'input_usd_per_million')::numeric,-1)<0
 or coalesce((p_price->>'output_usd_per_million')::numeric,-1)<0 then raise exception 'price_invalid'; end if;
 insert into public.os_lab_model_prices values(p_route,p_provider,p_model,p_region,p_price,p_source,p_checked,p_enabled)
 on conflict(route_id) do update set provider=excluded.provider,model=excluded.model,region=excluded.region,
 price=excluded.price,source_url=excluded.source_url,checked_at=excluded.checked_at,enabled=excluded.enabled;
end $$;
create function public.lab_owner_configure(p_agent_id uuid,p_new_agent jsonb,p_config jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.os_lab_agents; orig uuid; v uuid; slug text; route public.os_lab_model_prices; provider_id uuid;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 if (p_config->>'executor') not in ('edge','hermes') then raise exception 'executor_invalid'; end if;
 if p_config->>'executor'='edge' then
  update public.os_lab_agents set executor='edge' where id=p_agent_id; return p_agent_id;
 end if;
 select * into route from public.os_lab_model_prices where route_id=p_config->>'route_id' and enabled;
 if not found or route.provider is distinct from p_config->>'provider' or route.model is distinct from p_config->>'model'
 then raise exception 'route_invalid'; end if;
 if coalesce((p_config->>'max_cost_usd')::numeric,0)<=0 or coalesce((p_config->>'timeout_seconds')::int,0) not between 1 and 7200
 or coalesce((p_config->>'max_turns')::int,0) not between 1 and 90 or coalesce((p_config->>'max_output_tokens')::int,0) not between 1 and 8192
 then raise exception 'limits_invalid'; end if;
 select id into provider_id from public.os_lab_providers where name=route.provider;
 if provider_id is null then raise exception 'provider_row_missing'; end if;
 if p_agent_id is null then
  insert into public.os_lab_agents(slug,name,description,system_prompt,data_class,default_provider_id,executor)
  values(p_new_agent->>'slug',p_new_agent->>'name',coalesce(p_new_agent->>'description',''),p_new_agent->>'system_prompt','public',provider_id,'hermes') returning * into a;
 else
  select * into a from public.os_lab_agents where id=p_agent_id for update;
  if not found then raise exception 'agent_missing'; end if;
  if a.data_class='internal' then
   orig:=a.id;
   select successor_id into p_agent_id from lab_private.agent_successors where legacy_id=orig;
   if p_agent_id is null then
    slug:=a.slug||'-hermes';
    if exists(select 1 from public.os_lab_agents x where x.slug=slug) then slug:=slug||'-'||left(orig::text,8); end if;
    insert into public.os_lab_agents(slug,name,description,system_prompt,data_class,default_provider_id,executor)
    values(slug,a.name||' (Hermes)',a.description,a.system_prompt,'public',provider_id,'hermes') returning id into p_agent_id;
    insert into lab_private.agent_successors values(orig,p_agent_id);
   end if;
   select * into a from public.os_lab_agents where id=p_agent_id for update;
  end if;
 end if;
 select id into v from public.os_inst_agent_versions where agent_id=a.id and status='active' and system_prompt=a.system_prompt;
 if v is null then
  if exists(select 1 from public.os_inst_agent_versions where agent_id=a.id and status='active') then raise exception 'active_prompt_mismatch'; end if;
  -- Owner materializes CURRENT prompt only, never adopts a proposed revision.
  perform set_config('app.inst_seed','on',true);
  insert into public.os_inst_agent_versions(agent_id,version,system_prompt,status,proposed_by,rationale,diff,approved_by,approved_at)
  values(a.id,a.version,a.system_prompt,'active','director','Baseline prompt yang dipilih owner untuk eksekusi Hermes.','Initial baseline','director',now()) returning id into v;
  perform set_config('app.inst_seed','off',true);
 end if;
 if orig is not null then
  insert into public.os_lab_agent_files(version_id,path,content)
  select v,f.path,f.content from public.os_lab_agent_files f join public.os_inst_agent_versions av on av.id=f.version_id
  where av.agent_id=orig and av.status='active' on conflict do nothing;
 end if;
 update public.os_lab_agents set executor='hermes' where id=a.id;
 insert into public.os_lab_agent_execution(agent_id,config) values(a.id,p_config)
 on conflict(agent_id) do update set config=excluded.config,updated_at=now();
 return a.id;
end $$;
create function public.lab_owner_submit(p_submit_key uuid,p_agent uuid,p_question text,p_weight text default 'standard')
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.os_lab_agents; v public.os_inst_agent_versions; config jsonb; price public.os_lab_model_prices;
 h text; old public.os_lab_hermes_jobs; b uuid; assignment uuid; j uuid; payload jsonb;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_submit_key::text,0));
 h:=encode(sha256(convert_to(jsonb_build_array(p_agent,p_question,p_weight)::text,'UTF8')),'hex');
 select * into old from public.os_lab_hermes_jobs where submit_key=p_submit_key;
 if found then
  if old.submit_hash<>h then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('job_id',old.id,'brief_id',old.brief_id,'replay',true); end if;
 if length(p_question) not between 8 and 32000 or p_weight not in ('brief','standard','full') then raise exception 'input_invalid'; end if;
 select * into a from public.os_lab_agents where id=p_agent and executor='hermes' and is_active;
 if not found or a.data_class<>'public' then raise exception 'configure_public_successor'; end if;
 select * into v from public.os_inst_agent_versions where agent_id=p_agent and status='active' order by version desc limit 1 for share;
 if not found or v.system_prompt<>a.system_prompt then raise exception 'active_version_invalid'; end if;
 select e.config into config from public.os_lab_agent_execution e where agent_id=p_agent;
 -- Batas efektif ialah minimum ceiling agent dan default weight; retry tidak meresetnya.
 config:=config||jsonb_build_object(
 'max_cost_usd',least((config->>'max_cost_usd')::numeric,case p_weight when 'brief' then 2 when 'standard' then 6 else 12 end),
 'timeout_seconds',least((config->>'timeout_seconds')::int,case p_weight when 'brief' then 900 when 'standard' then 2700 else 7200 end),
 'max_turns',least((config->>'max_turns')::int,case p_weight when 'brief' then 20 when 'standard' then 50 else 90 end),
 'max_output_tokens',least((config->>'max_output_tokens')::int,case p_weight when 'brief' then 4096 else 8192 end));
 select * into price from public.os_lab_model_prices where route_id=config->>'route_id' and enabled;
 if not found then raise exception 'route_invalid'; end if;
 insert into public.os_inst_briefs(question,weight_class,data_class,status,started_at,brief)
 values(p_question,p_weight,'public','running',now(),jsonb_build_object('execution_mode','direct','estimator_version','hermes-direct-v1')) returning id into b;
 insert into public.os_inst_assignments(brief_id,agent_id,agent_slug,kind,input)
 values(b,p_agent,a.slug,'specialist_work',p_question) returning id into assignment;
 payload:=jsonb_build_object('schema_version','1','agent',jsonb_build_object('id',a.id,'slug',a.slug,'version_id',v.id,
 'system_prompt',v.system_prompt,'files',coalesce((select jsonb_agg(jsonb_build_object('path',path,'content',content,'sha256',content_hash)) from public.os_lab_agent_files where version_id=v.id),'[]'::jsonb)),
 'config',config,'price',to_jsonb(price),'input',jsonb_build_object('question',p_question,'brief_id',b,'assignment_id',assignment,'corpus_ids','[]'::jsonb));
 insert into public.os_lab_hermes_jobs(submit_key,submit_hash,brief_id,assignment_id,agent_id,payload,weight_class,max_cost_usd,timeout_seconds)
 values(p_submit_key,h,b,assignment,p_agent,payload,p_weight,(config->>'max_cost_usd')::numeric,(config->>'timeout_seconds')::integer) returning id into j;
 update public.os_lab_worker_wake set revision=revision+1,changed_at=now();
 return jsonb_build_object('job_id',j,'brief_id',b,'replay',false);
end $$;


create function public.lab_owner_files(p_version uuid,p_files jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare f jsonb; n integer:=0;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 perform 1 from public.os_inst_agent_versions where id=p_version and status='active' for update;
 if not found then raise exception 'version_invalid'; end if;
 if exists(select 1 from public.os_lab_agent_files where version_id=p_version)
 or exists(select 1 from public.os_lab_hermes_jobs where payload#>>'{agent,version_id}'=p_version::text) then raise exception 'reference_frozen'; end if;
 if jsonb_typeof(p_files)<>'array' or octet_length(p_files::text)>1048576 then raise exception 'files_invalid'; end if;
 for f in select * from jsonb_array_elements(p_files) loop
  if f->>'path' in ('SKILL.md','config.yaml','.env') then raise exception 'reserved_path'; end if;
  insert into public.os_lab_agent_files(version_id,path,content) values(p_version,f->>'path',f->>'content');n:=n+1;
 end loop;
 return n;
end $$;
create function public.lab_owner_run_status(p_job uuid,p_after bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.os_lab_hermes_jobs; events jsonb; usage jsonb;
begin
 if not public.os_key_valid() then raise exception 'owner_required' using errcode='42501'; end if;
 select * into j from public.os_lab_hermes_jobs where id=p_job;
 if not found then return null; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') into events
 from (select * from public.os_lab_hermes_events where job_id=p_job and id>p_after order by id limit 100) e;
 select jsonb_build_object('known_cost_usd',coalesce(sum(actual_usd),0),'unresolved_reserved_usd',
 coalesce(sum(reserved_usd) filter(where actual_usd is null),0),'input_tokens',sum((l.usage->>'input_tokens')::bigint),
 'output_tokens',sum((l.usage->>'output_tokens')::bigint)) into usage from lab_private.usage_ledger l where job_id=p_job;
 return jsonb_build_object('job',to_jsonb(j)-'lease_token','events',events,'usage',usage,'attempts',
 coalesce((select jsonb_agg(jsonb_build_object('attempt',a.attempt,'status',a.status,'run_id',a.run_id,
 'started_at',a.started_at,'finished_at',a.finished_at,'tokens_in',r.tokens_in,'tokens_out',r.tokens_out,'cost_usd',r.cost_usd)
 order by a.attempt) from public.os_lab_hermes_attempts a join public.os_lab_runs r on r.id=a.run_id where a.job_id=p_job),'[]'),
 'workers',
 coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('online',w.last_seen_at>now()-interval '30 seconds')) from public.os_lab_worker_status w),'[]'));
end $$;

-- Tolak secara default, termasuk grant eksplisit bawaan Supabase.
do $block$ declare r record; begin
 for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='lab_private' or (n.nspname='public' and p.proname like 'lab_%') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',r.nspname,r.proname,r.args);
  if r.nspname='public' and r.proname like 'lab_worker_%' then
   execute format('grant execute on function %I.%I(%s) to authenticated',r.nspname,r.proname,r.args);
  elsif r.nspname='public' and r.proname like 'lab_enrol_%' then
   execute format('grant execute on function %I.%I(%s) to service_role',r.nspname,r.proname,r.args);
  elsif r.nspname='public' and r.proname like 'lab_owner_%' then
   execute format('grant execute on function %I.%I(%s) to anon,authenticated',r.nspname,r.proname,r.args);
  end if;
 end loop;
end $block$;
commit;
