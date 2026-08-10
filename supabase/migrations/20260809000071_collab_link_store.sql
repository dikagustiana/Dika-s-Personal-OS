-- ===========================================================================
-- THE MINTED SIGN-IN LINK GETS A HOME THE TAB CANNOT TAKE WITH IT.
-- ===========================================================================
-- A link already survives navigating off Finish line: migration-free, in
-- sessionStorage (src/data/collabLinkVault.ts). That closed the reported bug
-- and left the rest of it open, because sessionStorage is scoped to ONE TAB ON
-- ONE DEVICE. Close the tab, switch browsers, or pick the phone up instead,
-- and the link is gone — and the only way back is "Tautan baru", which is
-- exactly the destructive act:
--
--   auth.one_time_tokens carries a UNIQUE index on (user_id, token_type)
--   (one_time_tokens_user_id_token_type_key, verified live). One live token
--   per person. Minting a replacement KILLS the one already handed over.
--
-- So the owner still ends up cutting somebody off to recover a link they
-- merely misplaced. This table is where that stops.
--
-- ===========================================================================
-- THIS STORES A LIVE CREDENTIAL AT REST. THAT IS THE TRADE, AND IT IS THE
-- OWNER'S TO MAKE — BUT THE SHAPE HERE IS WHAT KEEPS IT PAYABLE.
-- ===========================================================================
-- The vault's own header argued against exactly this, and it was right at the
-- time: persisting an hour-long credential buys durability the credential does
-- not have. Two things changed. The window is being set to 86400s, so there is
-- now a day of durability worth keeping; and a lost link costs somebody else
-- their access, which a browser-local store cannot prevent.
--
-- What makes it acceptable is that the row is owner-only in the database and
-- dies on every event that ends its usefulness — used, expired, revoked. It is
-- not an archive. There is at most ONE row per collaborator, ever, enforced by
-- the primary key rather than by a rule someone has to remember.
--
-- ===========================================================================
-- WHAT IS STORED, AND WHAT IS REFUSED.
-- ===========================================================================
--   user_id      who it opens for
--   link         the copyable URL
--   created_at   when Supabase minted it — see below, this is NOT our clock
--   expires_at   when it dies, NULLABLE — see below, null means "not known"
--   used_at      when it was spent, null while unused
--
-- No ip, no user agent, no device, no location, no count of anything. This is
-- a place to put one credential so it can be handed over twice, not a record
-- of the person it belongs to.
--
-- NO FOREIGN KEY on user_id, matching every other public table here — not one
-- of them references auth.users. The cleanup path is explicit instead: revoke
-- deletes the row, and this app never deletes an auth user (revoking removes
-- membership on both axes and deliberately leaves the account, so history
-- keeps its actor).
--
-- ===========================================================================
-- created_at IS SUPABASE'S, NOT OURS. expires_at IS NULLABLE ON PURPOSE.
-- ===========================================================================
-- generateLink's response carries NO expiry — GoTrue does not return one, and
-- otp_exp is not readable from the database or from any endpoint the anon or
-- service keys reach. The previous code papered over that with
-- `LINK_TTL_SECONDS = 3600` and `now + 3600`, which was a guess wearing a
-- constant's clothing, and it is about to become a WRONG guess when the window
-- is set to 86400.
--
-- So neither value is invented here:
--
--   created_at  is read back from auth.one_time_tokens.created_at — the row
--               GoTrue itself writes when it mints the token. Authoritative,
--               and immune to a wrong clock on whoever's laptop.
--               (GoTrue files magic-link tokens under token_type
--               'recovery_token'; there is no 'magiclink' member of that enum.
--               Verified live.)
--   expires_at  is created_at + a window that comes from CONFIGURATION, never
--               from a literal in code. When the function is not configured
--               with one, this column stays NULL and the surface says the
--               window is unknown rather than drawing a countdown nobody can
--               justify.
--
-- A NULL here therefore means "we do not know when this dies", which is a
-- different and more honest thing than "it does not expire".
--
-- ===========================================================================
-- RLS: OWNER ONLY, FOUR POLICIES.
-- ===========================================================================
-- The four `require app key to …` policies, exactly the os_process_* shape —
-- NOT the two-policy append-only shape the history tables use. This table is
-- not a log: rows are replaced when a link is re-minted, updated when one is
-- spent, and deleted on revoke, so update and delete have real work to do.
--
-- A COLLABORATOR GETS NOTHING. No member policy, and none should be added:
-- they already hold their own link, so a read here buys them nothing and
-- would put every OTHER collaborator's live credential one policy mistake
-- away. Their read returns zero rows without error.
--
-- APPLIED 2026-08-09 via the Supabase apply_migration tool (ledger name
-- `collab_link_store`). NEVER apply with `supabase db push`, `migration up`,
-- `db reset`, or `db remote commit`.
--
-- Verified live after applying, every probe inside a rolled-back transaction
-- so the table carries no residue from being tested:
--   * four policies exist and no more — select, insert, update, delete, all
--     gated on os_key_valid();
--   * WITH A REAL ROW PRESENT, a signed-in collaborator (role `authenticated`,
--     their own JWT sub) reads 0, and `anon` without the app-key header reads
--     0, while the owner path reads 1. Zero here is a refusal, not an empty
--     table;
--   * FORCING THE MARKING TO FAIL — a sabotage trigger raising on every write
--     to os_collab_links — the sign-in still committed, os_sign_in_log still
--     gained its row (4 -> 5), and used_at stayed null. A failure to mark a
--     link cannot cost anyone a session, which is the property that matters
--     most in this file.
--
-- The Edge Function that fills this table was redeployed the same day
-- (provision-collaborator v3) and smoke-tested: a call without the app key
-- answers 401 from checkAppKey rather than a 500, so the module graph loads
-- and the owner gate is intact.
--
-- The frontend ships BEFORE this runs, and the two not-yet states stay
-- SEPARATE: 42P01 (this table is absent) folds to "the link section does not
-- render"; 42703 (a column missing from a table that exists) is a broken query
-- and must surface. Neither guard may be widened to swallow the other.
--
-- Idempotent throughout. Down-migration:
-- supabase/migrations/down/20260809000071_collab_link_store_down.sql

create table if not exists public.os_collab_links (
  -- PRIMARY KEY, not just an index: "at most one live link per person" is a
  -- rule the schema keeps, not one a caller has to remember. An upsert on
  -- conflict replaces, which mirrors what GoTrue does to the token itself.
  user_id    uuid        primary key,
  link       text        not null,
  created_at timestamptz not null,
  expires_at timestamptz,
  used_at    timestamptz
);

comment on table public.os_collab_links is
  'At most one un-handed-over sign-in link per collaborator, so the owner can copy it again without minting a replacement — minting kills the token already sent. Owner-only by RLS; no member policy, and none should be added. Holds no ip, user agent, device or location. Deleted on revoke, on re-mint, and once spent.';
comment on column public.os_collab_links.created_at is
  'auth.one_time_tokens.created_at — the instant GoTrue minted the token, read back from its own row rather than taken from any client clock. GoTrue files magic-link tokens under token_type ''recovery_token''.';
comment on column public.os_collab_links.expires_at is
  'created_at + the configured OTP window. NULLABLE, and null means THE WINDOW IS NOT KNOWN — generateLink returns no expiry and otp_exp is not readable from the database, so this is derived from configuration and is absent when that configuration is absent. Never a hardcoded constant.';
comment on column public.os_collab_links.used_at is
  'Set by os_mark_collab_link_used when the person signs in. Null while the link is still spendable.';

create index if not exists os_collab_links_expiry_idx
  on public.os_collab_links (expires_at);

alter table public.os_collab_links enable row level security;

-- The four-policy owner shape from os_process_*. See the header for why this
-- is not the append-only pair.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_collab_links'
                 and policyname = 'require app key to select') then
    create policy "require app key to select" on public.os_collab_links
      for select using ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_collab_links'
                 and policyname = 'require app key to insert') then
    create policy "require app key to insert" on public.os_collab_links
      for insert with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_collab_links'
                 and policyname = 'require app key to update') then
    create policy "require app key to update" on public.os_collab_links
      for update using ((select public.os_key_valid()))
      with check ((select public.os_key_valid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_collab_links'
                 and policyname = 'require app key to delete') then
    create policy "require app key to delete" on public.os_collab_links
      for delete using ((select public.os_key_valid()));
  end if;
end
$$;

-- ===========================================================================
-- MARKING A LINK SPENT: A SECOND TRIGGER, NOT AN EDIT TO THE FIRST.
-- ===========================================================================
-- os_record_sign_in (20260809000070) already fires on last_sign_in_at changing
-- and would have been the obvious place to add two more lines. It is
-- deliberately left alone.
--
-- That function sits on the authentication path, it is live, and it is
-- correct. Editing it to also touch a table that did not exist when it was
-- written puts the sign-in LOG at risk of a bug belonging to the sign-in LINK,
-- and the two have nothing to do with each other beyond sharing a moment. Two
-- independent triggers on the same event fail independently: a mistake here
-- cannot cost a log row, and a mistake there cannot cost a link marking.
--
-- Both properties that make the first one safe are reproduced here, because
-- they are the properties that matter, not the function they live in:
--
--   SECURITY DEFINER   this runs as supabase_auth_admin inside GoTrue's own
--                      transaction, which holds no rights in public.
--   exceptions swallowed
--                      A FAILURE TO MARK A LINK MUST NEVER BECOME A FAILURE
--                      TO LOG IN. The audited action here is authentication
--                      itself; refusing it is by far the larger harm, and the
--                      person it would lock out is the owner as readily as
--                      anyone. A stale row that still says "aktif" is a
--                      cosmetic wrong. A raised exception is a lockout.
create or replace function public.os_mark_collab_link_used()
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
      -- Only an UNSPENT row is stamped: the first sign-in is the one that
      -- spends the magic link, and a later sign-in on a refreshed session
      -- must not rewrite that moment.
      update public.os_collab_links
         set used_at = new.last_sign_in_at
       where user_id = new.id
         and used_at is null;
    exception
      when others then
        null;  -- see the header: never block a sign-in.
    end;
  end if;
  return null;  -- AFTER trigger; the return value is discarded.
end;
$$;

revoke all on function public.os_mark_collab_link_used() from public;
revoke all on function public.os_mark_collab_link_used() from anon;
revoke all on function public.os_mark_collab_link_used() from authenticated;

drop trigger if exists os_mark_collab_link_used on auth.users;
create trigger os_mark_collab_link_used
  after insert or update of last_sign_in_at on auth.users
  for each row execute function public.os_mark_collab_link_used();
