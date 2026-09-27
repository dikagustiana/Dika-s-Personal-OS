-- DRAFT PHASE 3. Bukan hak untuk mengubah prompt aktif.
begin;
create table public.os_lab_hermes_proposals (
 job_id uuid not null references public.os_lab_hermes_jobs(id),target_agent_id uuid not null references public.os_lab_agents(id),
 base_version_id uuid not null references public.os_inst_agent_versions(id),
 proposed_hash text not null,version_id uuid not null unique references public.os_inst_agent_versions(id),
 primary key(job_id,target_agent_id,proposed_hash)
);
alter table public.os_lab_hermes_proposals enable row level security;
revoke all on public.os_lab_hermes_proposals from public,anon,authenticated;
grant select on public.os_lab_hermes_proposals to anon,authenticated;
create policy director_select on public.os_lab_hermes_proposals for select using(public.os_key_valid());
-- lab_worker_propose (04) insert proposed + linkage atomik; tidak mengubah guard 100.
commit;
