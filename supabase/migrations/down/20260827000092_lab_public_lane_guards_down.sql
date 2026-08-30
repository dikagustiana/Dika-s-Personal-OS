-- Down-migration for 20260827000092_lab_public_lane_guards.sql
--
-- Drops the two guards that separate the public lane from the internal one.
--
-- Applying this REOPENS both holes it closed:
--   * data_class becomes editable again, so an internal agent — prompt and
--     all — can be flipped to 'public' and pointed at a non-Anthropic
--     provider. That is the laundering vector.
--   * the anthropic row's base_url becomes editable again, so the endpoint
--     the internal boundary trusts by name can be repointed at another host.
--
-- It exists because every migration here carries a rollback, not because
-- rolling back is advisable. If a guard is in the way, the wall is in the
-- way, and that is a conversation with the owner, not a down-migration.
--
-- Nothing else is restored or altered: 092 created only these two functions
-- and their triggers, and touched no pre-existing object.

drop trigger if exists os_lab_agents_class_freeze_guard on public.os_lab_agents;
drop function if exists public.os_lab_agents_class_freeze_guard();

drop trigger if exists os_lab_providers_endpoint_pin_guard on public.os_lab_providers;
drop function if exists public.os_lab_providers_endpoint_pin_guard();
