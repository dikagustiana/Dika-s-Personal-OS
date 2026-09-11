-- Rollback of 20260910000099_institution_schema. Drops every institution
-- table and the two agent columns. Apply 101 and 100 downs first.
do $$
declare tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array['os_inst_assignments','os_inst_reviews','os_inst_submissions','os_inst_debates',
      'os_inst_agent_versions','os_inst_egress_blocks','os_inst_events','os_inst_briefs'] loop
      if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tbl) then
        execute format('alter publication supabase_realtime drop table public.%I', tbl);
      end if;
    end loop;
  end if;
end $$;
drop table if exists public.os_inst_events;
drop table if exists public.os_inst_egress_blocks;
drop table if exists public.os_inst_evaluation_runs;
drop table if exists private.os_inst_evaluation_rubrics;
drop table if exists public.os_inst_evaluations;
drop table if exists public.os_inst_debates;
alter table if exists public.os_inst_reviews drop constraint if exists os_inst_reviews_submission_fk;
drop table if exists public.os_inst_submissions;
alter table if exists public.os_inst_agent_versions drop constraint if exists os_inst_agent_versions_review_fk;
drop table if exists public.os_inst_reviews;
alter table if exists public.os_inst_corpus drop constraint if exists os_inst_corpus_assignment_fk;
drop table if exists public.os_inst_assignments;
alter table if exists public.os_inst_briefs drop constraint if exists os_inst_briefs_final_output_fk;
drop table if exists public.os_inst_corpus;
drop table if exists public.os_inst_briefs;
drop table if exists public.os_inst_agent_versions;
drop table if exists public.os_inst_department_members;
drop table if exists public.os_inst_departments;
alter table public.os_lab_agents drop column if exists authored_by_agent_id, drop column if exists authoring_purpose;
