-- ===========================================================================
-- NO USER IS BORN WITH A PASSWORD — closing the GoTrue birth-hash surprise.
-- ===========================================================================
-- Standing check 2 fired on 2026-08-05: the two collaborators created that
-- day through provision-collaborator held non-null encrypted_password from
-- the moment of creation (updated_at == created_at for the never-signed-in
-- one; the auth log shows only user_signedup events, no password change).
-- The provisioning code sets no password — audited, still true — but
-- GoTrue's admin createUser GENERATES a random password hash when none is
-- supplied. The hand-inserted selftest user, which never went through
-- GoTrue, is the row that stayed null. So "no password path in our code"
-- was necessary but not sufficient: the platform had one of its own.
--
-- The generated hash is unknown to everyone and practically unguessable,
-- but the recorded boundary says the password grant is INERT because no
-- user holds a password — and that must be a fact of the schema, not of
-- GoTrue's current default. Two moves:
--
--   1. REPAIR + NORMALIZE: every encrypted_password becomes '' — including
--      the null one. '' fails every bcrypt compare (the grant stays dead)
--      and, unlike NULL, cannot hit GoTrue's Go string scanner, which this
--      project has already watched 500 on a NULL token column
--      ("converting NULL to string is unsupported", auth log 2026-08-04).
--   2. A BEFORE INSERT trigger on auth.users forces encrypted_password to
--      '' at birth, whoever inserts — GoTrue admin API, SQL, anything. A
--      usable password can now only arrive by a deliberate post-birth
--      UPDATE (the recovery flow or a live session's updateUser), which is
--      exactly the residual already recorded in REVIEW.md: the mailbox is
--      the factor. Standing check 2 flags any real hash that appears.
--
-- Auth-schema DDL is deliberately minimal: one BEFORE INSERT trigger
-- touching one column of NEW, no reads, no other rows.
--
-- APPLIED 2026-08-05 via the Supabase apply_migration tool (ledger name
-- `birth_password_guard`). NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260804000049_birth_password_guard_down.sql
-- (drops the guard; the generated hashes it erased are not restorable and
-- were never known to anyone.)

create or replace function public.os_auth_users_birth_password_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- '' and never NULL: bcrypt-compare-proof, Go-scanner-proof.
  new.encrypted_password := '';
  return new;
end;
$$;

revoke all on function public.os_auth_users_birth_password_guard() from public;
revoke all on function public.os_auth_users_birth_password_guard() from anon;
revoke all on function public.os_auth_users_birth_password_guard() from authenticated;

drop trigger if exists os_auth_users_birth_password_guard on auth.users;
create trigger os_auth_users_birth_password_guard
  before insert on auth.users
  for each row execute function public.os_auth_users_birth_password_guard();

-- Repair the two generated hashes and normalize the null row, one statement.
update auth.users
   set encrypted_password = ''
 where encrypted_password is distinct from '';
