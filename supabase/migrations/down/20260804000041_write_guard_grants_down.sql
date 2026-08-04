-- Down-migration for 20260804000041_write_guard_grants.
-- Restores the Supabase default-privilege state the function was created
-- with. Nothing depends on these grants; this exists only so the down chain
-- reproduces the exact pre-migration state.

grant execute on function public.os_finish_line_cells_write_guard() to anon;
grant execute on function public.os_finish_line_cells_write_guard() to authenticated;
