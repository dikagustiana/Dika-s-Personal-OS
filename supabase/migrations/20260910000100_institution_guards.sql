-- =============================================================================
-- INSTITUTION: enforcement. B-1, B-2, B-3, B-5, B-8, B-9 and data_class
-- propagation, as triggers and key-gated definer functions.
-- =============================================================================
--
-- APPLIED LIVE 2026-09-10 via apply_migration, one migration at a time
-- (ledger name `institution_guards`) after scripts/institution-tests.sh is
-- green. Never `db push` / `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260910000100_institution_guards_down.sql.
--
-- IDENTITY, the same way the epistemic gates (077) tell owner from agent:
-- the director's requests carry the x-app-key header and public.os_key_valid()
-- is true; the stepper writes under the service role with no header, so
-- os_key_valid() is false for every agent by construction. Two more GUCs,
-- both transaction-local and set only inside the definer functions below:
--   app.inst_promotion = 'on'   while os_inst_version_promote / _reject /
--                               _set_eval rewrite version rows and (promote
--                               only) the live prompt;
--   app.inst_scoring   = 'on'   while os_inst_eval_score writes a score;
--   app.inst_seed      = 'on'   inside a migration that seeds director-owned
--                               rows (internal agents, active versions,
--                               evaluations). A migration is a deliberate act
--                               with a diff — the escape hatch this repo uses
--                               everywhere else — and it is the only context
--                               that sets it.
--
-- House conventions (074/077): function and trigger share a name, security
-- definer, set search_path = '', EXECUTE revoked from client roles on trigger
-- functions.

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.os_inst_guc_on(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting(p_name, true), '') = 'on';
$$;
revoke all on function public.os_inst_guc_on(text) from public;

create or replace function public.os_inst_committee_slug()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.lead_agent_slug from public.os_inst_departments d where d.kind = 'committee' limit 1;
$$;
revoke all on function public.os_inst_committee_slug() from public;

-- ---------------------------------------------------------------------------
-- B-1: the live prompt changes only through promotion
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_agents_prompt_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.system_prompt is distinct from old.system_prompt
     and not public.os_inst_guc_on('app.inst_promotion') then
    raise exception 'B-1: os_lab_agents.system_prompt is never written directly — propose a row in os_inst_agent_versions (status=proposed) and let the director promote it with os_inst_version_promote(). Agent % keeps running its current version.', old.slug;
  end if;
  return new;
end;
$$;
revoke all on function public.os_lab_agents_prompt_lock() from public;

drop trigger if exists os_lab_agents_prompt_lock on public.os_lab_agents;
create trigger os_lab_agents_prompt_lock
  before update of system_prompt on public.os_lab_agents
  for each row execute function public.os_lab_agents_prompt_lock();

-- ---------------------------------------------------------------------------
-- B-3: agents created without the director are public; re-laning is the
-- director's act; authorship is frozen
-- ---------------------------------------------------------------------------
create or replace function public.os_lab_agents_lane_at_birth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.data_class = 'internal' then
      if new.authored_by_agent_id is not null then
        raise exception 'B-3: agent % was authored by another agent and is therefore public. Promotion to internal is a director action.', new.slug;
      end if;
      if not public.os_key_valid() and not public.os_inst_guc_on('app.inst_seed') then
        raise exception 'B-3: creating an internal agent (%) requires the director credential — a generated prompt does not reach SAMB financial data on the strength of its generator''s judgement.', new.slug;
      end if;
    end if;
    return new;
  end if;
  -- UPDATE
  if new.authored_by_agent_id is distinct from old.authored_by_agent_id then
    raise exception 'B-3: authored_by_agent_id is provenance and is frozen after insert (agent %).', old.slug;
  end if;
  if new.data_class is distinct from old.data_class and not public.os_key_valid() then
    raise exception 'B-3: changing data_class of agent % is the director''s act, never an agent''s.', old.slug;
  end if;
  return new;
end;
$$;
revoke all on function public.os_lab_agents_lane_at_birth() from public;

drop trigger if exists os_lab_agents_lane_at_birth on public.os_lab_agents;
create trigger os_lab_agents_lane_at_birth
  before insert or update on public.os_lab_agents
  for each row execute function public.os_lab_agents_lane_at_birth();

-- ---------------------------------------------------------------------------
-- agent versions: immutable outside the definer functions (B-1, B-2)
-- ---------------------------------------------------------------------------
create or replace function public.os_inst_agent_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_slug text;
begin
  if tg_op = 'DELETE' then
    raise exception 'os_inst_agent_versions is immutable — a version is never deleted (agent version %).', old.id;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'proposed' and not public.os_inst_guc_on('app.inst_promotion')
       and not public.os_inst_guc_on('app.inst_seed') then
      raise exception 'B-1: a version is born proposed. Only os_inst_version_promote() makes one active.';
    end if;
    if new.status = 'proposed' and (length(trim(new.rationale)) < 10 or length(new.diff) = 0) then
      raise exception 'B-1: a proposal carries a rationale and a diff, or it is not a proposal.';
    end if;
    select a.slug into target_slug from public.os_lab_agents a where a.id = new.agent_id;
    -- B-2: nothing reviews the committee. A proposal against its prompt comes
    -- from the committee itself (a self-upgrade) or from the director; a lead
    -- or the program office cannot propose to change what reviews them.
    if target_slug = public.os_inst_committee_slug()
       and new.proposed_by_agent_id is not null
       and new.proposed_by_agent_id <> new.agent_id then
      raise exception 'B-2: the committee''s prompt is the system''s fixed point — only the committee itself or the director may propose a change to it.';
    end if;
    return new;
  end if;
  -- UPDATE: only the definer functions, which set the GUC.
  if not public.os_inst_guc_on('app.inst_promotion') then
    raise exception 'B-1: version rows change only through os_inst_version_promote(), os_inst_version_reject() or os_inst_version_set_eval() (agent version %).', old.id;
  end if;
  return new;
end;
$$;
revoke all on function public.os_inst_agent_versions_guard() from public;

drop trigger if exists os_inst_agent_versions_guard on public.os_inst_agent_versions;
create trigger os_inst_agent_versions_guard
  before insert or update or delete on public.os_inst_agent_versions
  for each row execute function public.os_inst_agent_versions_guard();

-- The director promotes. The only code path that writes a live prompt.
create or replace function public.os_inst_version_promote(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.os_inst_agent_versions%rowtype;
  live_prompt text;
  live_slug text;
  new_version int;
begin
  if not public.os_key_valid() then
    raise exception 'B-1: only the director promotes a version.';
  end if;
  select * into v from public.os_inst_agent_versions where id = p_version_id for update;
  if not found then
    raise exception 'os_inst_version_promote: no version %.', p_version_id;
  end if;
  if v.status <> 'proposed' then
    raise exception 'os_inst_version_promote: version % is %, not proposed.', p_version_id, v.status;
  end if;
  select a.system_prompt, a.slug into live_prompt, live_slug from public.os_lab_agents a where a.id = v.agent_id for update;
  if live_prompt = v.system_prompt then
    raise exception 'os_inst_version_promote: version % is identical to the live prompt of % — nothing to promote.', p_version_id, live_slug;
  end if;
  perform set_config('app.inst_promotion', 'on', true);
  update public.os_inst_agent_versions set status = 'retired'
    where agent_id = v.agent_id and status = 'active';
  update public.os_lab_agents set system_prompt = v.system_prompt where id = v.agent_id;
  select a.version into new_version from public.os_lab_agents a where a.id = v.agent_id;
  update public.os_inst_agent_versions
    set status = 'active', version = new_version, approved_by = 'director', approved_at = now()
    where id = p_version_id;
  perform set_config('app.inst_promotion', 'off', true);
  insert into public.os_inst_events (kind, agent_slug, payload)
    values ('version.promoted', live_slug, jsonb_build_object('versionId', p_version_id, 'version', new_version));
end;
$$;
revoke all on function public.os_inst_version_promote(uuid) from public;
grant execute on function public.os_inst_version_promote(uuid) to anon, authenticated;

create or replace function public.os_inst_version_reject(p_version_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.os_inst_agent_versions%rowtype;
  live_slug text;
begin
  if not public.os_key_valid() then
    raise exception 'B-1: only the director rejects a version.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'os_inst_version_reject: a rejection carries a reason — it is the only external check on the committee.';
  end if;
  select * into v from public.os_inst_agent_versions where id = p_version_id for update;
  if not found or v.status <> 'proposed' then
    raise exception 'os_inst_version_reject: version % is not a pending proposal.', p_version_id;
  end if;
  select a.slug into live_slug from public.os_lab_agents a where a.id = v.agent_id;
  perform set_config('app.inst_promotion', 'on', true);
  update public.os_inst_agent_versions
    set status = 'rejected', rejected_reason = p_reason, approved_by = 'director', approved_at = now()
    where id = p_version_id;
  perform set_config('app.inst_promotion', 'off', true);
  insert into public.os_inst_events (kind, agent_slug, payload)
    values ('version.rejected', live_slug, jsonb_build_object('versionId', p_version_id, 'reason', p_reason));
end;
$$;
revoke all on function public.os_inst_version_reject(uuid, text) from public;
grant execute on function public.os_inst_version_reject(uuid, text) to anon, authenticated;

-- Eval scores attach to the proposal row (B-9). A system act, so no key —
-- but service role only, and it writes nothing except the two score columns.
create or replace function public.os_inst_version_set_eval(p_version_id uuid, p_phase text, p_score numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_phase not in ('before', 'after') then
    raise exception 'os_inst_version_set_eval: phase is before or after.';
  end if;
  perform set_config('app.inst_promotion', 'on', true);
  if p_phase = 'before' then
    update public.os_inst_agent_versions set eval_score_before = p_score where id = p_version_id;
  else
    update public.os_inst_agent_versions set eval_score_after = p_score where id = p_version_id;
  end if;
  perform set_config('app.inst_promotion', 'off', true);
end;
$$;
revoke all on function public.os_inst_version_set_eval(uuid, text, numeric) from public;
grant execute on function public.os_inst_version_set_eval(uuid, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- corpus: lane propagation, hash correctness, immutability (B-6, B-8)
-- ---------------------------------------------------------------------------
create or replace function public.os_inst_corpus_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  must_internal boolean := false;
  reason text := '';
begin
  if tg_op = 'UPDATE' then
    if new.content is distinct from old.content or new.content_hash is distinct from old.content_hash
       or new.kind is distinct from old.kind or new.data_class is distinct from old.data_class
       or new.provenance is distinct from old.provenance or new.url is distinct from old.url
       or new.derived_from is distinct from old.derived_from or new.created_by_agent_id is distinct from old.created_by_agent_id
       or new.created_by_run_id is distinct from old.created_by_run_id or new.brief_id is distinct from old.brief_id
       or new.fetched_at is distinct from old.fetched_at or new.query is distinct from old.query then
      raise exception 'os_inst_corpus: record % is frozen — a citation must resolve to the same text forever. Only review_status may change; a correction is a new record.', old.id;
    end if;
    return new;
  end if;
  if new.content_hash <> encode(sha256(convert_to(new.content, 'UTF8')), 'hex') then
    raise exception 'os_inst_corpus: content_hash does not match sha256(content) — a hash that does not verify is not provenance.';
  end if;
  if exists (select 1 from public.os_inst_corpus c where c.id = any(new.derived_from) and c.data_class = 'internal') then
    must_internal := true; reason := 'it derives from an internal corpus record';
  elsif new.created_by_agent_id is not null and exists (
      select 1 from public.os_lab_agents a where a.id = new.created_by_agent_id and a.data_class = 'internal') then
    must_internal := true; reason := 'it was produced by an internal agent';
  elsif new.brief_id is not null and exists (
      select 1 from public.os_inst_briefs b where b.id = new.brief_id and b.data_class = 'internal') then
    must_internal := true; reason := 'it belongs to an internal brief';
  end if;
  if must_internal and new.data_class = 'public' then
    raise exception 'data_class: corpus record "%" cannot be public — %. An output derived from any internal input is internal.', new.title, reason;
  end if;
  if array_length(new.derived_from, 1) is not null and exists (
      select 1 from unnest(new.derived_from) d where not exists (select 1 from public.os_inst_corpus c where c.id = d)) then
    raise exception 'os_inst_corpus: derived_from cites a record that does not exist.';
  end if;
  return new;
end;
$$;
revoke all on function public.os_inst_corpus_guard() from public;

drop trigger if exists os_inst_corpus_guard on public.os_inst_corpus;
create trigger os_inst_corpus_guard
  before insert or update on public.os_inst_corpus
  for each row execute function public.os_inst_corpus_guard();

-- Briefs: once internal, never public again (an agent cannot downgrade the
-- lane of work that has touched internal data).
create or replace function public.os_inst_briefs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.data_class = 'internal' and new.data_class = 'public' then
    raise exception 'data_class: brief % touched internal data and cannot become public.', old.id;
  end if;
  return new;
end;
$$;
revoke all on function public.os_inst_briefs_guard() from public;

drop trigger if exists os_inst_briefs_guard on public.os_inst_briefs;
create trigger os_inst_briefs_guard
  before update on public.os_inst_briefs
  for each row execute function public.os_inst_briefs_guard();

-- ---------------------------------------------------------------------------
-- reviews: never by the author; a lead review by that department's lead; a
-- committee review by the committee (1-A, 1-D)
-- ---------------------------------------------------------------------------
create or replace function public.os_inst_reviews_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_id uuid;
  dept_lead_slug text;
  reviewer_slug text;
begin
  select a.slug into reviewer_slug from public.os_lab_agents a where a.id = new.reviewer_agent_id;
  if new.subject_assignment_id is not null then
    select s.agent_id into author_id from public.os_inst_assignments s where s.id = new.subject_assignment_id;
    if new.subject_agent_id is null then new.subject_agent_id := author_id; end if;
  end if;
  author_id := coalesce(author_id, new.subject_agent_id);
  if author_id is not null and author_id = new.reviewer_agent_id then
    raise exception '1-A: a review is never by its own author — % cannot review its own work (the actor who proposes never verifies).', reviewer_slug;
  end if;
  if new.kind = 'lead' and new.subject_assignment_id is not null then
    select d.lead_agent_slug into dept_lead_slug
      from public.os_inst_assignments s join public.os_inst_departments d on d.id = s.department_id
      where s.id = new.subject_assignment_id;
    if dept_lead_slug is not null and dept_lead_slug <> reviewer_slug then
      raise exception '1-A: a lead review of this department is by its lead (%), not %.', dept_lead_slug, reviewer_slug;
    end if;
  end if;
  if new.kind = 'committee' and reviewer_slug <> public.os_inst_committee_slug() then
    raise exception '1-D: a committee review is by the committee (%), not %.', public.os_inst_committee_slug(), reviewer_slug;
  end if;
  return new;
end;
$$;
revoke all on function public.os_inst_reviews_guard() from public;

drop trigger if exists os_inst_reviews_guard on public.os_inst_reviews;
create trigger os_inst_reviews_guard
  before insert on public.os_inst_reviews
  for each row execute function public.os_inst_reviews_guard();

-- Debates: the committee does not rebut itself.
create or replace function public.os_inst_debates_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rebutter text;
begin
  select a.slug into rebutter from public.os_lab_agents a where a.id = new.rebutting_agent_id;
  if rebutter = public.os_inst_committee_slug() then
    raise exception '1-D: the committee weighs rebuttals; it does not file them.';
  end if;
  if tg_op = 'UPDATE' and (new.rebuttal is distinct from old.rebuttal or new.review_id is distinct from old.review_id
       or new.rebutting_agent_id is distinct from old.rebutting_agent_id or new.round is distinct from old.round) then
    raise exception '1-D: a rebuttal is a record; only its weighing and outcome are written later.';
  end if;
  return new;
end;
$$;
revoke all on function public.os_inst_debates_guard() from public;

drop trigger if exists os_inst_debates_guard on public.os_inst_debates;
create trigger os_inst_debates_guard
  before insert or update on public.os_inst_debates
  for each row execute function public.os_inst_debates_guard();

-- Submissions: a department does not submit to itself.
create or replace function public.os_inst_submissions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.to_department_id is not null and new.to_department_id = new.from_department_id then
    raise exception '1-A: a submission goes to the next department or the committee, not back to its own department.';
  end if;
  return new;
end;
$$;
revoke all on function public.os_inst_submissions_guard() from public;

drop trigger if exists os_inst_submissions_guard on public.os_inst_submissions;
create trigger os_inst_submissions_guard
  before insert on public.os_inst_submissions
  for each row execute function public.os_inst_submissions_guard();

-- ---------------------------------------------------------------------------
-- evaluations (B-9): director-owned; rubric private; scores only by the scorer
-- ---------------------------------------------------------------------------
create or replace function public.os_inst_evaluations_owner_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.os_key_valid() and not public.os_inst_guc_on('app.inst_seed') then
    raise exception 'B-9: %: the evaluation set is held fixed by the director — no agent writes to it.', tg_table_name;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.os_inst_evaluations_owner_guard() from public;

drop trigger if exists os_inst_evaluations_owner_guard on public.os_inst_evaluations;
create trigger os_inst_evaluations_owner_guard
  before insert or update or delete on public.os_inst_evaluations
  for each row execute function public.os_inst_evaluations_owner_guard();

drop trigger if exists os_inst_evaluation_rubrics_owner_guard on private.os_inst_evaluation_rubrics;
create trigger os_inst_evaluation_rubrics_owner_guard
  before insert or update or delete on private.os_inst_evaluation_rubrics
  for each row execute function public.os_inst_evaluations_owner_guard();

create or replace function public.os_inst_evaluation_runs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'B-9: evaluation runs are a record and are never deleted.';
  end if;
  if tg_op = 'UPDATE' and (new.answer is distinct from old.answer or new.evaluation_id is distinct from old.evaluation_id
       or new.agent_id is distinct from old.agent_id or new.phase is distinct from old.phase) then
    raise exception 'B-9: an evaluation answer is frozen once recorded.';
  end if;
  if new.score is not null and (tg_op = 'INSERT' or new.score is distinct from old.score)
     and not public.os_inst_guc_on('app.inst_scoring') then
    raise exception 'B-9: a score is written by os_inst_eval_score() alone — an agent (or the stepper) cannot grade itself.';
  end if;
  return new;
end;
$$;
revoke all on function public.os_inst_evaluation_runs_guard() from public;

drop trigger if exists os_inst_evaluation_runs_guard on public.os_inst_evaluation_runs;
create trigger os_inst_evaluation_runs_guard
  before insert or update or delete on public.os_inst_evaluation_runs
  for each row execute function public.os_inst_evaluation_runs_guard();

-- The scorer: deterministic, rubric never leaves the database. Returns the
-- score it wrote. Service role only — the stepper calls it after an eval run.
create or replace function public.os_inst_eval_score(p_run_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.os_inst_evaluation_runs%rowtype;
  rb jsonb;
  answer text;
  n_items int;
  n_hit int;
  s_contain numeric := null;
  s_numbers numeric := null;
  s_forbid numeric := null;
  s_cite numeric := null;
  w jsonb;
  total_w numeric := 0;
  total numeric := 0;
  item text;
begin
  select * into r from public.os_inst_evaluation_runs where id = p_run_id for update;
  if not found then raise exception 'os_inst_eval_score: no evaluation run %.', p_run_id; end if;
  select rubric into rb from private.os_inst_evaluation_rubrics where evaluation_id = r.evaluation_id;
  if rb is null then raise exception 'os_inst_eval_score: evaluation % has no rubric.', r.evaluation_id; end if;
  answer := lower(coalesce(r.answer, ''));
  w := coalesce(rb -> 'weights', '{}'::jsonb);

  if jsonb_typeof(rb -> 'mustContain') = 'array' and jsonb_array_length(rb -> 'mustContain') > 0 then
    n_items := 0; n_hit := 0;
    for item in select jsonb_array_elements_text(rb -> 'mustContain') loop
      n_items := n_items + 1;
      if position(lower(item) in answer) > 0 then n_hit := n_hit + 1; end if;
    end loop;
    s_contain := n_hit::numeric / n_items;
  end if;
  if jsonb_typeof(rb -> 'mustContainNumbers') = 'array' and jsonb_array_length(rb -> 'mustContainNumbers') > 0 then
    n_items := 0; n_hit := 0;
    for item in select jsonb_array_elements_text(rb -> 'mustContainNumbers') loop
      n_items := n_items + 1;
      if answer ~ ('(^|[^0-9.,])' || regexp_replace(item, '([.])', '\\\1', 'g') || '($|[^0-9])') then n_hit := n_hit + 1; end if;
    end loop;
    s_numbers := n_hit::numeric / n_items;
  end if;
  if jsonb_typeof(rb -> 'mustNotContain') = 'array' and jsonb_array_length(rb -> 'mustNotContain') > 0 then
    s_forbid := 1;
    for item in select jsonb_array_elements_text(rb -> 'mustNotContain') loop
      if position(lower(item) in answer) > 0 then s_forbid := 0; end if;
    end loop;
  end if;
  if coalesce((rb ->> 'mustCite')::boolean, false) then
    s_cite := case when answer ~ '\[corpus:[0-9a-f-]{8,}\]' or answer ~ 'assumption:' then 1 else 0 end;
  end if;

  if s_contain is not null then total := total + s_contain * coalesce((w ->> 'contain')::numeric, 0.4); total_w := total_w + coalesce((w ->> 'contain')::numeric, 0.4); end if;
  if s_numbers is not null then total := total + s_numbers * coalesce((w ->> 'numbers')::numeric, 0.3); total_w := total_w + coalesce((w ->> 'numbers')::numeric, 0.3); end if;
  if s_forbid is not null then total := total + s_forbid * coalesce((w ->> 'forbid')::numeric, 0.2); total_w := total_w + coalesce((w ->> 'forbid')::numeric, 0.2); end if;
  if s_cite is not null then total := total + s_cite * coalesce((w ->> 'cite')::numeric, 0.1); total_w := total_w + coalesce((w ->> 'cite')::numeric, 0.1); end if;
  if total_w = 0 then raise exception 'os_inst_eval_score: rubric for % has no scorable component.', r.evaluation_id; end if;

  perform set_config('app.inst_scoring', 'on', true);
  update public.os_inst_evaluation_runs set score = round(total / total_w, 3) where id = p_run_id;
  perform set_config('app.inst_scoring', 'off', true);
  return round(total / total_w, 3);
end;
$$;
revoke all on function public.os_inst_eval_score(uuid) from public;
grant execute on function public.os_inst_eval_score(uuid) to service_role;

-- The director may read a rubric (to author and audit the set); agents cannot:
-- key-gated, and private.* is unreachable through the API regardless.
create or replace function public.os_inst_eval_rubric(p_evaluation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rb jsonb;
begin
  if not public.os_key_valid() then
    raise exception 'B-9: the rubric is read by the director alone.';
  end if;
  select rubric into rb from private.os_inst_evaluation_rubrics where evaluation_id = p_evaluation_id;
  return rb;
end;
$$;
revoke all on function public.os_inst_eval_rubric(uuid) from public;
grant execute on function public.os_inst_eval_rubric(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- the director's decision on a brief (1-E)
-- ---------------------------------------------------------------------------
create or replace function public.os_inst_brief_decide(p_brief_id uuid, p_decision text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.os_inst_briefs%rowtype;
begin
  if not public.os_key_valid() then
    raise exception '1-E: only the director decides a brief.';
  end if;
  if p_decision not in ('approved', 'rejected', 'published') then
    raise exception '1-E: decision is approved, rejected or published.';
  end if;
  if p_decision = 'rejected' and length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception '1-E: a rejection carries a reason — rejection reasons are the only external check on the committee.';
  end if;
  select * into b from public.os_inst_briefs where id = p_brief_id for update;
  if not found then raise exception 'os_inst_brief_decide: no brief %.', p_brief_id; end if;
  if b.status not in ('director', 'approved') then
    raise exception '1-E: brief % is % — it has not reached the director''s room.', p_brief_id, b.status;
  end if;
  if p_decision = 'published' and b.status <> 'approved' then
    raise exception '1-E: approve before publishing.';
  end if;
  update public.os_inst_briefs
    set status = p_decision, director_decision = p_decision, director_reason = p_reason, decided_at = now()
    where id = p_brief_id;
  insert into public.os_inst_events (brief_id, kind, payload)
    values (p_brief_id, 'director.decided', jsonb_build_object('decision', p_decision, 'reason', p_reason));
end;
$$;
revoke all on function public.os_inst_brief_decide(uuid, text, text) from public;
grant execute on function public.os_inst_brief_decide(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- events: append-only
-- ---------------------------------------------------------------------------
create or replace function public.os_inst_events_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'os_inst_events is append-only.';
end;
$$;
revoke all on function public.os_inst_events_guard() from public;

drop trigger if exists os_inst_events_guard on public.os_inst_events;
create trigger os_inst_events_guard
  before update or delete on public.os_inst_events
  for each row execute function public.os_inst_events_guard();
