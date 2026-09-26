-- DRAFT PHASE 2. Stepper Edge mengisi tabel ini lewat RPC service-role-only, bukan worker generic CRUD.
begin;
alter table public.os_inst_briefs add column execution_revision bigint not null default 0;
create table lab_private.institution_outbox (
 action_key text primary key,brief_id uuid not null references public.os_inst_briefs(id),
 action jsonb not null,status text not null default 'pending' check(status in ('pending','dispatched','done','failed')),
 job_id uuid references public.os_lab_hermes_jobs(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.os_lab_hermes_claims (
 job_id uuid not null references public.os_lab_hermes_jobs(id),claim_id text not null,
 text text not null,kind text not null check(kind in ('fact','inference','assumption')),
 primary key(job_id,claim_id)
);
create table public.os_lab_hermes_claim_refs (
 job_id uuid not null,claim_id text not null,corpus_id uuid not null references public.os_inst_corpus(id),
 locator text not null default '',primary key(job_id,claim_id,corpus_id),
 foreign key(job_id,claim_id) references public.os_lab_hermes_claims(job_id,claim_id)
);
alter table public.os_lab_hermes_claims enable row level security;
alter table public.os_lab_hermes_claim_refs enable row level security;
revoke all on public.os_lab_hermes_claims,public.os_lab_hermes_claim_refs from public,anon,authenticated;
grant select on public.os_lab_hermes_claims,public.os_lab_hermes_claim_refs to anon,authenticated;
create policy director_select on public.os_lab_hermes_claims for select using(public.os_key_valid());
create policy director_select on public.os_lab_hermes_claim_refs for select using(public.os_key_valid());
-- Fable Phase 2 menambahkan validasi claim_refs dan INSERT dalam transaksi lab_worker_finish,
-- sebelum status succeeded. Referensi harus input snapshot atau archive attempt, bukan rubric/eval.
-- Deployment tidak boleh mengaktifkan provenance_required sebelum validator/projection atomik tersedia.
commit;
