-- Reverts 20260817000081_lab_scout_curation.sql: drops the curation tables,
-- removes the recheck columns, restores the generic owner guard on source
-- documents (the 077 arrangement), and retires the scout registry row.

drop trigger if exists os_lab_candidate_sources_gate_guard on public.os_lab_candidate_sources;
drop function if exists public.os_lab_candidate_sources_gate_guard();
drop table if exists public.os_lab_candidate_sources;

drop trigger if exists os_lab_publisher_tiers_gate_guard on public.os_lab_publisher_tiers;
drop function if exists public.os_lab_publisher_tiers_gate_guard();
drop table if exists public.os_lab_publisher_tiers;

-- Source documents back to the 077 arrangement: generic owner guard, no
-- keyless recheck shape, no flag columns.
drop trigger if exists os_lab_source_documents_gate_guard on public.os_lab_source_documents;
drop function if exists public.os_lab_source_documents_gate_guard();
drop trigger if exists os_lab_source_documents_owner_guard on public.os_lab_source_documents;
create trigger os_lab_source_documents_owner_guard
  before insert or update or delete on public.os_lab_source_documents
  for each row execute function public.os_lab_owner_write_guard();

alter table public.os_lab_source_documents
  drop column if exists last_rechecked_at,
  drop column if exists content_changed_at;

delete from public.os_lab_agents where slug = 'evidence-scout';
