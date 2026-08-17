-- Down-migration for 20260817000074_lab_data_boundary.
-- REMOVES THE DATA BOUNDARY: after this runs, nothing in the database stops
-- an internal agent from being pointed at, or run on, DeepSeek or Kimi.
-- The executor's re-validation (layer 2) and the disabled selector (layer 3)
-- still stand, but the layer that holds when they have bugs is gone. This
-- file exists for schema rollback only — never run it to "unblock" a run
-- the trigger refused; the trigger refusing IS the feature.
-- Triggers first, then functions, mirror order.

drop trigger if exists os_lab_providers_boundary_guard on public.os_lab_providers;
drop function if exists public.os_lab_providers_boundary_guard();

drop trigger if exists os_lab_runs_boundary_guard on public.os_lab_runs;
drop function if exists public.os_lab_runs_boundary_guard();

drop trigger if exists os_lab_agents_boundary_guard on public.os_lab_agents;
drop function if exists public.os_lab_agents_boundary_guard();
