-- DRAFT PHASE 1. Bukan migration auto-apply. Prasyarat schema P 099-107 terverifikasi.
begin;
create schema if not exists lab_private;
revoke all on schema lab_private from public,anon,authenticated;

alter table public.os_lab_agents add column if not exists executor text not null default 'edge'
 check (executor in ('edge','hermes'));
-- Menambah nama provider, bukan menghapus boundary data_class. Provider ID tetap wajib nyata.
alter table public.os_lab_providers drop constraint if exists os_lab_providers_name_check;
alter table public.os_lab_providers add constraint os_lab_providers_name_check
 check(name in ('anthropic','deepseek','kimi','nous'));

create table public.os_lab_agent_execution (
 agent_id uuid primary key references public.os_lab_agents(id),
 config jsonb not null check(jsonb_typeof(config)='object'),
 updated_at timestamptz not null default now()
);
create table public.os_lab_agent_files (
 version_id uuid not null references public.os_inst_agent_versions(id),
 path text not null check(path !~ '(^/|(^|/)\.\.(/|$))' and path !~ '[\\]'),
 content text not null,
 content_hash text not null default '' check(content_hash ~ '^[a-f0-9]{64}$'),
 primary key(version_id,path)
);
create function lab_private.file_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' then raise exception 'reference_immutable'; end if;
 new.content_hash:=encode(sha256(convert_to(new.content,'UTF8')),'hex');
 return new;
end $$;
create trigger lab_file_guard before insert or update or delete on public.os_lab_agent_files
for each row execute function lab_private.file_guard();
create table public.os_lab_model_prices (
 route_id text primary key,
 provider text not null check(provider in ('kimi','deepseek','anthropic','nous')),
 model text not null, region text not null,
 price jsonb not null, source_url text not null check(source_url like 'https://%'),
 checked_at timestamptz not null, enabled boolean not null default false
);
create table lab_private.workers (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null unique references auth.users(id),
 name text not null, enabled boolean not null default true,
 last_seen_at timestamptz, runtime_sha text, capabilities jsonb not null default '{}'
);
create table lab_private.agent_successors (
 legacy_id uuid primary key references public.os_lab_agents(id),
 successor_id uuid not null unique references public.os_lab_agents(id)
);
create table lab_private.pairings (
 code_hash text primary key, name text not null, expires_at timestamptz not null,
 consumed_at timestamptz, worker_id uuid
);
create table lab_private.settings (
 singleton boolean primary key default true check(singleton),
 paused boolean not null default false,
 concurrency integer not null default 1 check(concurrency=1),
 enforce_daily boolean not null default false,
 daily_limit_usd numeric(16,8) not null default 20 check(daily_limit_usd>0)
);
insert into lab_private.settings(singleton) values(true);
create table public.os_lab_worker_status (
 worker_id uuid primary key references lab_private.workers(id),
 name text not null,last_seen_at timestamptz not null,runtime_sha text,
 active_job_id uuid, health text not null default 'online'
);
-- Hint tanpa payload Lab; SELECT own-row JWT hanya di tabel ini.
create table public.os_lab_worker_wake (
 auth_user_id uuid primary key references auth.users(id),
 revision bigint not null default 0,changed_at timestamptz not null default now()
);
create table public.os_lab_hermes_jobs (
 id uuid primary key default gen_random_uuid(),
 submit_key uuid not null unique, submit_hash text not null,
 brief_id uuid not null references public.os_inst_briefs(id),
 assignment_id uuid not null references public.os_inst_assignments(id),
 agent_id uuid not null references public.os_lab_agents(id),
 payload jsonb not null,
 weight_class text not null check(weight_class in ('brief','standard','full')),
 mode text not null default 'direct' check(mode in ('direct','institution')),
 status text not null default 'queued' check(status in
 ('queued','running','validating','retry_wait','cancel_requested','succeeded','failed','cancelled','timed_out','budget_exceeded')),
 attempt integer not null default 0 check(attempt between 0 and 3),
 worker_id uuid references lab_private.workers(id),lease_token uuid,lease_until timestamptz,
 run_id uuid references public.os_lab_runs(id),
 created_at timestamptz not null default now(),claimed_at timestamptz,attempt_started_at timestamptz,deadline_at timestamptz,
 available_at timestamptz not null default now(),finished_at timestamptz,
 result_hash text,result jsonb,final_corpus_id uuid references public.os_inst_corpus(id),error jsonb,
 max_cost_usd numeric(16,8) not null check(max_cost_usd>0),
 timeout_seconds integer not null check(timeout_seconds between 1 and 7200)
);
create index os_lab_hermes_jobs_claim_idx on public.os_lab_hermes_jobs(status,available_at,created_at);
create table public.os_lab_hermes_attempts (
 job_id uuid not null references public.os_lab_hermes_jobs(id),attempt integer not null,
 worker_id uuid not null references lab_private.workers(id),lease_token uuid not null unique,
 run_id uuid not null unique references public.os_lab_runs(id),
 started_at timestamptz not null default now(),finished_at timestamptz,status text not null,
 primary key(job_id,attempt)
);
create table public.os_lab_hermes_events (
 id bigint generated always as identity primary key,
 job_id uuid not null references public.os_lab_hermes_jobs(id),attempt integer not null,
 sequence bigint not null,kind text not null,
 emitted_at timestamptz not null,received_at timestamptz not null default now(),
 payload jsonb not null default '{}',unique(job_id,attempt,sequence)
);
create table lab_private.usage_ledger (
 job_id uuid not null references public.os_lab_hermes_jobs(id),attempt integer not null,
 call_id uuid not null,route_id text not null,
 reserved_usd numeric(16,8) not null check(reserved_usd>0),
 actual_usd numeric(16,8) check(actual_usd>=0),
 usage jsonb,created_at timestamptz not null default now(),settled_at timestamptz,
 primary key(job_id,attempt,call_id)
);
create table lab_private.archives (
 job_id uuid not null references public.os_lab_hermes_jobs(id),attempt integer not null,
 operation_id uuid not null,body_hash text not null,corpus_id uuid not null references public.os_inst_corpus(id),
 primary key(job_id,attempt,operation_id)
);
-- Semua data operasional baru hanya director; worker membaca melalui RPC.
do $block$
declare n text;
begin
 foreach n in array array['os_lab_agent_execution','os_lab_agent_files','os_lab_model_prices','os_lab_worker_status',
  'os_lab_hermes_jobs','os_lab_hermes_attempts','os_lab_hermes_events'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
  execute format('grant select on public.%I to anon,authenticated',n);
  execute format('create policy director_select on public.%I for select to anon,authenticated using(public.os_key_valid())',n);
 end loop;
end $block$;
alter table public.os_lab_worker_wake enable row level security;
revoke all on public.os_lab_worker_wake from public,anon,authenticated;
grant select on public.os_lab_worker_wake to authenticated;
create policy worker_wake_select on public.os_lab_worker_wake for select to authenticated
 using(auth_user_id=auth.uid());
-- Jangan tambah tabel berpayload ke publikasi tanpa RLS. Wake opsional dan aman tanpa publikasi.
do $block$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.os_lab_worker_wake;
 end if;
end $block$;
commit;
