-- Down-migration for 20260804000049_birth_password_guard.
-- Drops the birth guard: users created after this can again carry whatever
-- password GoTrue generates at admin createUser. The hashes the up-migration
-- erased are NOT restorable — they were random, server-generated, and known
-- to nobody, so nothing of value is lost either way.

drop trigger if exists os_auth_users_birth_password_guard on auth.users;
drop function if exists public.os_auth_users_birth_password_guard();
