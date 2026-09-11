-- Rollback of 20260910000105.
--
-- os_inst_agent_versions is immutable to every client and to every agent:
-- os_inst_agent_versions_guard refuses DELETE outright, because a version
-- history with rows removed is not a history. This rollback therefore runs
-- as the migration role with the trigger disabled for the length of one
-- statement, and it only removes a proposal that was never acted on.
-- If the director has already promoted or rejected it, nothing is deleted.
alter table public.os_inst_agent_versions disable trigger os_inst_agent_versions_guard;

delete from public.os_inst_agent_versions v
using public.os_lab_agents a
where v.agent_id = a.id
  and a.slug = 'evidence-coordinator'
  and v.proposed_by = 'system'
  and v.status = 'proposed';

alter table public.os_inst_agent_versions enable trigger os_inst_agent_versions_guard;
