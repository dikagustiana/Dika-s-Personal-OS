-- ===========================================================================
-- WHEN PEOPLE SIGNED IN. A log, because nothing in this database is one.
-- ===========================================================================
-- Two candidate sources already exist and NEITHER is a log:
--
--   auth.audit_log_entries   the table is present and holds ZERO rows, while
--                            four users have signed in. Whatever GoTrue is
--                            configured to do on this project, it is not
--                            writing there. A source that is empty after the
--                            events it should have recorded is not a source.
--   auth.users.last_sign_in_at
--                            ONE timestamp, overwritten on every sign-in. It
--                            answers "when last" and can never answer "when",
--                            which is the question. It is what the Kolaborator
--                            row's `masuk` line already shows.
--
-- So the log has to be built.
--
-- ===========================================================================
-- MECHANISM: A DATABASE TRIGGER, NOT A FRONTEND WRITE. AND THE REASON.
-- ===========================================================================
-- The two options were a trigger on auth.users, or a write from the client
-- when a session is established. The trigger wins on the only criterion that
-- matters for an audit trail: A LOG THE CLIENT CAN SKIP IS NOT A LOG. A
-- frontend write is missed by every sign-in that does not reach that code path
-- — a stale bundle, a crash before the call, a tab closed early, a request
-- that fails silently, or simply a future entry point that forgets to call it.
-- None of those are exotic; the collaborator flow in this app already has more
-- than one way into a session.
--
-- The stated risk of the trigger route was that it touches the `auth` schema
-- and might be restricted on this project. IT IS NOT: this project already
-- carries a non-internal trigger on auth.users —
-- os_auth_users_birth_password_guard, added by migration 20260804000049 and
-- verified live in pg_trigger before this file was written. The precedent
-- settles the permission question, so the more correct option is also the
-- available one.
--
-- The trigger fires when last_sign_in_at CHANGES, which is exactly what GoTrue
-- updates on a successful sign-in and does not touch on a token refresh. First
-- sign-in (NULL -> timestamp) is covered by `is distinct from`. The INSERT arm
-- exists only for completeness: in this project a user is created by
-- provision-collaborator with no sign-in and receives a link afterwards, so a
-- born-signed-in row is not a path anyone uses — but if it ever happened, a
-- silently missing first line would be worse than an unused branch.
--
-- ===========================================================================
-- THE TRIGGER MUST NEVER BE ABLE TO BLOCK A SIGN-IN.
-- ===========================================================================
-- This runs inside GoTrue's own UPDATE on auth.users. An exception here aborts
-- that transaction, which means a failure to WRITE A LOG LINE becomes a
-- failure to LOG IN — for the owner as readily as for anyone else, and with no
-- obvious cause on the surface. The whole point of this package is that the
-- owner must not lose access.
--
-- So the insert is wrapped and every exception is swallowed. That is a
-- deliberate inversion of this schema's usual rule (see os_provision_record,
-- where an unlogged action must not succeed silently): there, the audited
-- action is a privileged write we control and can refuse; here, the audited
-- action is authentication itself, and refusing it is the larger harm. A
-- missing line is a gap in a log. A raised exception is a lockout.
--
-- ===========================================================================
-- WHAT IS RECORDED, AND WHAT IS DELIBERATELY NOT.
-- ===========================================================================
--   user_id      who
--   signed_in_at when
--
-- That is the whole table. NO ip address, NO user agent, NO location, NO
-- device or session fingerprint, NO count of anything. GoTrue has some of that
-- available at this moment and it is not read here. The question asked was
-- when people signed in; a device profile is a different question that nobody
-- asked, and collecting it because it happens to be in scope is how an audit
-- trail turns into surveillance of the people doing the work.
--
-- For the same reason there is nothing here about what anyone LOOKED at. This
-- table records an event that changes state (a session begins). It does not
-- record views, clicks, dwell time, or navigation, and no such column may be
-- added to it later without that being a decision taken on its own terms.
--
-- NO FOREIGN KEY on user_id, matching os_finish_line_cell_history.actor: an
-- audit row must outlive the account it names. A cascade from auth.users would
-- delete exactly the history that a departing collaborator's trail consists
-- of, which is the opposite of what a log is for.
--
-- The (user_id, signed_in_at) unique constraint makes the write idempotent: if
-- the trigger ever fires twice for one sign-in, the second insert is dropped
-- rather than doubling the count.
--
-- ===========================================================================
-- RLS: OWNER ONLY. ONE POLICY.
-- ===========================================================================
-- SELECT for the app key, and nothing else. There is deliberately NO insert
-- policy for any client role — the trigger function is SECURITY DEFINER and
-- writes past RLS, so a client insert finds no policy and is refused. No
-- UPDATE policy, no DELETE policy, for anyone including the owner: an editable
-- log is not a log.
--
-- Whether a collaborator may read their OWN sign-ins is a separate decision
-- and is NOT taken here. No member policy is added; adding one later is a
-- deliberate act, not a symmetry fix.
--
-- APPLIED 2026-08-09 via the Supabase apply_migration tool (ledger name
-- `sign_in_log`, live version 20260809131555). NEVER apply with
-- `supabase db push`, `migration up`, `db reset`, or `db remote commit`.
--
-- Verified live after applying:
--   * the seed wrote 3 rows for the 3 accounts that carry a last_sign_in_at;
--     the fourth has never signed in and contributed nothing;
--   * the table holds exactly id, user_id, signed_in_at — no ip, user agent,
--     location or device column exists to be filled;
--   * setting last_sign_in_at the way GoTrue does added EXACTLY ONE row, and
--     a subsequent unrelated UPDATE on the same user added none. (Probed
--     inside a rolled-back transaction; the live count is back to 3.)
--   * the linter reports no new advisory: os_record_sign_in is absent from it
--     because EXECUTE is revoked from public, anon and authenticated.
--
-- The frontend ships BEFORE this runs: a read of this table answers 42P01
-- until it lands, and the Kolaborator screen treats that as "the log section
-- does not render" — not an error, not a crash, and nothing on the console.
-- That guard recognises 42P01 and PGRST205 ONLY; a 42703 from this table would
-- be a genuine failure and must stay visible.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260809000070_sign_in_log_down.sql

-- 1. The table. Two facts and a surrogate key.
create table if not exists public.os_sign_in_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null,
  signed_in_at timestamptz not null,
  constraint os_sign_in_log_once unique (user_id, signed_in_at)
);

comment on table public.os_sign_in_log is
  'Append-only record of sign-in events: who and when, nothing else. Written exclusively by the os_record_sign_in trigger on auth.users, which cannot be bypassed by a client. NO ip, user agent, location or device data is recorded, and no view/click/duration tracking belongs here. No UPDATE or DELETE policy exists for anyone, including the owner.';
comment on column public.os_sign_in_log.user_id is
  'auth.users.id. Deliberately NO foreign key: a sign-in record must outlive the account it names, and a cascade would erase precisely the trail a departed collaborator consists of. Same reasoning as os_finish_line_cell_history.actor.';
comment on column public.os_sign_in_log.signed_in_at is
  'The value auth.users.last_sign_in_at was set to — GoTrue''s own timestamp for the event, not the moment the trigger ran.';

create index if not exists os_sign_in_log_user_idx
  on public.os_sign_in_log (user_id, signed_in_at desc);

alter table public.os_sign_in_log enable row level security;

-- 2. One policy: the owner reads. See the header before adding a second.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_sign_in_log'
                 and policyname = 'owner reads sign-in log') then
    create policy "owner reads sign-in log" on public.os_sign_in_log
      for select using ((select public.os_key_valid()));
  end if;
end
$$;

-- 3. The recorder. SECURITY DEFINER because it runs inside GoTrue's own
--    transaction as supabase_auth_admin, which holds no rights in public.
create or replace function public.os_record_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_sign_in_at is not null
     and (tg_op = 'INSERT' or new.last_sign_in_at is distinct from old.last_sign_in_at)
  then
    begin
      insert into public.os_sign_in_log (user_id, signed_in_at)
      values (new.id, new.last_sign_in_at)
      on conflict on constraint os_sign_in_log_once do nothing;
    exception
      when others then
        -- A log line that cannot be written must never cost anyone a session.
        -- See the header: here the audited action is authentication itself.
        null;
    end;
  end if;
  return null;  -- AFTER trigger; the return value is discarded.
end;
$$;

revoke all on function public.os_record_sign_in() from public;
revoke all on function public.os_record_sign_in() from anon;
revoke all on function public.os_record_sign_in() from authenticated;

drop trigger if exists os_record_sign_in on auth.users;
create trigger os_record_sign_in
  after insert or update of last_sign_in_at on auth.users
  for each row execute function public.os_record_sign_in();

-- 4. The one sign-in each existing user can still prove.
--
-- NOT A BACKFILL OF HISTORY — it cannot be. last_sign_in_at holds only the
-- MOST RECENT sign-in, so this seeds at most one row per user and every
-- earlier sign-in those four accounts made is unrecoverable. It is here so the
-- log does not open completely blank while still being honest about what it
-- contains: each row is a real event with GoTrue's own timestamp, not an
-- invented one. Users who have never signed in contribute nothing.
insert into public.os_sign_in_log (user_id, signed_in_at)
select u.id, u.last_sign_in_at
  from auth.users u
 where u.last_sign_in_at is not null
on conflict on constraint os_sign_in_log_once do nothing;
