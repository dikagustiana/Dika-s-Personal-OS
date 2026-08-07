-- ===========================================================================
-- EIGHT MEMBERSHIP-BASED SELECT POLICIES ON THE os_process_* TABLES.
-- ===========================================================================
--
-- ===========================================================================
-- ALREADY APPLIED LIVE. DO NOT APPLY. This file exists to RECORD it.
-- ===========================================================================
-- Written straight to production from another session, ledger name
-- `process_member_read_policies`. There was no file. This is the file.
--
-- Every statement below is guarded by `if not exists`, so running this is a
-- no-op against the database. What it is NOT a no-op against is the record: a
-- second ledger entry for one logical change, and the next session reading
-- that ledger cannot tell which of the two actually did anything. The
-- migration history is the only memory a session without memory has. Leave it
-- alone.
--
-- APPLY 20260806000057 (THE GRANT) FIRST. In live these two went in the other
-- order and that is precisely what broke production — see that file's header.
-- The numbering here is the fix, and it only matters for environments that do
-- not exist yet.
--
-- ===========================================================================
-- ADDITIVE. THE FOUR `require app key to …` POLICIES ARE UNTOUCHED.
-- ===========================================================================
-- Postgres ORs permissive policies, so these sit beside the owner's existing
-- passphrase policies rather than replacing them. Nothing here grants a
-- write: SELECT only, on eight of the nine os_process_* tables. The
-- INSERT/UPDATE/DELETE policies still require `os_key_valid()`, so a
-- contributor is read-only and `requested_on` stays owner-only.
--
-- `to public`, NOT `to authenticated` — AND THAT IS THE LOAD-BEARING DETAIL.
-- This is what live holds, so it is what this file records. It also differs
-- from migration 20260804000040, whose member policies ARE `to authenticated`,
-- and the difference is the whole reason 57 exists: `public` includes `anon`,
-- so `anon` evaluates these predicates, so `anon` must be able to execute
-- `os_member_entities()`. If you ever narrow these to `to authenticated`, the
-- grant in 57 becomes unnecessary — but do not do it as a tidy-up, because
-- the owner's own requests run as `anon` and the interaction is not obvious.
--
-- ===========================================================================
-- WHY MEMBERSHIP, AND NOT A READ-ONLY KEY
-- ===========================================================================
-- A read-only key already exists (`os_read_key_valid()`, 20260729040353) and
-- would have been fewer lines. It was the wrong shape. Each collaborator
-- carries entity chips precisely so their access can be NARROWER than "all" —
-- handing out a key that reads everything would make those chips decorative,
-- and a permission model that displays a scope it does not enforce is worse
-- than one with no scope at all.
--
-- The side effect is the good kind, and it cost no code: the entity picker
-- narrows itself. It is built from `distinct entity_code` over the rows that
-- came back, so a contributor holding only ARBI receives only ARBI steps and
-- the picker renders one entity. No allow-list in the frontend, no per-role
-- branch, nothing to keep in sync — the data the reader is allowed to see IS
-- the vocabulary the control offers.
--
-- ===========================================================================
-- THE NINTH TABLE, os_process_text_history, GETS NOTHING. DELIBERATELY.
-- ===========================================================================
-- It is the edit audit log, and it has no UI anywhere in the app yet — it is
-- read through the Supabase console. A contributor loses nothing they could
-- have seen. Whether contributors should see who changed which sentence is a
-- real question and it should be answered together with the screen that shows
-- it, not settled here by a policy nobody would remember writing. Until then
-- it stays owner-only, and a member's read of it returns zero rows WITHOUT
-- error — which is the behaviour the per-role suite pins.
--
-- ===========================================================================
-- THE PREDICATES, AND WHY THEY ARE NOT ALL THE SAME
-- ===========================================================================
--   steps / lanes / phases / tracks   carry entity_code directly.
--   needs / step_items                reach it through their step.
--   gates                             carry a NULLABLE entity_code: a null
--                                     gate is shared across entities, so it
--                                     is visible to anyone holding ANY
--                                     membership, and the `<> '{}'` test is
--                                     what stops that clause from handing
--                                     shared gates to a non-member.
--   references                        carry no entity at all — the reading
--                                     list is group-level by design — so the
--                                     only question is whether the caller
--                                     holds any membership.
--
-- Every call is wrapped `(select public.os_member_entities())` so Postgres
-- evaluates it once per query as an InitPlan rather than once per row. That
-- wrap is the house pattern from 20260728000030 and dropping it reintroduces
-- a cost class that produced a live 500. It is also, exactly, what makes a
-- missing EXECUTE grant unsurvivable — see 57.
--
-- Down-migration:
-- supabase/migrations/down/20260806000058_process_member_read_policies_down.sql

do $$
begin
  -- ----- carries entity_code directly ---------------------------------------
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_steps'
                 and policyname = 'member reads own-entity rows') then
    create policy "member reads own-entity rows" on public.os_process_steps
      for select
      using (entity_code = any ((select public.os_member_entities())::text[]));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_lanes'
                 and policyname = 'member reads own-entity rows') then
    create policy "member reads own-entity rows" on public.os_process_lanes
      for select
      using (entity_code = any ((select public.os_member_entities())::text[]));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_phases'
                 and policyname = 'member reads own-entity rows') then
    create policy "member reads own-entity rows" on public.os_process_phases
      for select
      using (entity_code = any ((select public.os_member_entities())::text[]));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_tracks'
                 and policyname = 'member reads own-entity rows') then
    create policy "member reads own-entity rows" on public.os_process_tracks
      for select
      using (entity_code = any ((select public.os_member_entities())::text[]));
  end if;

  -- ----- nullable entity_code: a null gate is shared ------------------------
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_gates'
                 and policyname = 'member reads own-entity gates') then
    create policy "member reads own-entity gates" on public.os_process_gates
      for select
      using (
        (select public.os_member_entities()) <> '{}'::text[]
        and (
          entity_code is null
          or entity_code = any ((select public.os_member_entities())::text[])
        )
      );
  end if;

  -- ----- reaches entity_code through its step -------------------------------
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_needs'
                 and policyname = 'member reads own-entity needs') then
    create policy "member reads own-entity needs" on public.os_process_needs
      for select
      using (
        exists (
          select 1 from public.os_process_steps s
          where s.id = os_process_needs.step_id
            and s.entity_code = any ((select public.os_member_entities())::text[])
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_step_items'
                 and policyname = 'member reads own-entity bridge') then
    create policy "member reads own-entity bridge" on public.os_process_step_items
      for select
      using (
        exists (
          select 1 from public.os_process_steps s
          where s.id = os_process_step_items.step_id
            and s.entity_code = any ((select public.os_member_entities())::text[])
        )
      );
  end if;

  -- ----- no entity at all: group-level reading list -------------------------
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'os_process_references'
                 and policyname = 'member reads references') then
    create policy "member reads references" on public.os_process_references
      for select
      using ((select public.os_member_entities()) <> '{}'::text[]);
  end if;
end
$$;
