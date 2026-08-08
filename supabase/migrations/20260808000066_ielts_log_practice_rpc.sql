-- ===========================================================================
-- ONE CALL WRITES A PRACTICE ATTEMPT AND ITS TAGS, OR WRITES NEITHER.
-- ===========================================================================
-- The log form writes two tables: os_ielts_practice, then one
-- os_ielts_practice_topic row per weakness tag. Done as two client round
-- trips, a failure between them leaves a practice row with no tags — and that
-- row is WORSE THAN NOTHING. It counts toward "sessions logged this week", so
-- the dashboard says practice happened, while contributing zero to the
-- weakness ratios that practice was supposed to inform. Nothing surfaces the
-- discrepancy; the numbers just quietly disagree.
--
-- A function body is one transaction, so the pair is atomic here and cannot
-- be atomic in the client.
--
-- SECURITY INVOKER, NOT DEFINER — deliberately, and this is the important
-- line in the file. DEFINER would run as the owner and BYPASS the RLS
-- policies both tables carry, turning a logging helper into a way to write
-- rows without holding the app key. INVOKER keeps the caller's context, so
-- `require app key to insert` is evaluated exactly as it would be for a
-- direct insert. The function adds atomicity and no authority.
--
-- VERIFIED 2026-08-08: a call whose tag list names a slug that is not in
-- os_ielts_topic raises foreign_key_violation AND leaves zero rows in
-- os_ielts_practice — the practice row rolls back with the tag, which is the
-- whole point of the function.
--
-- APPLIED 2026-08-08 via the Supabase apply_migration tool (ledger name
-- `ielts_log_practice_rpc`). NEVER apply with `supabase db push`,
-- `migration up`, `db reset`, or `db remote commit`.
--
-- Idempotent (create or replace). Safe to re-run.

create or replace function public.os_ielts_log_practice(
  p_skill            text,
  p_source           text,
  p_attempted_on     date,
  p_timed            boolean,
  p_raw_score        int,
  p_band             numeric,
  p_duration_minutes int,
  p_notes            text,
  -- [{"slug": "reading/matching-headings", "attempted": 10, "missed": 6}, ...]
  -- or, for writing and speaking, {"slug": "...", "severity": 2}.
  p_topics           jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.os_ielts_practice
    (skill, source, attempted_on, timed, raw_score, band, duration_minutes, notes)
  values
    (p_skill, p_source, p_attempted_on, coalesce(p_timed, true),
     p_raw_score, p_band, p_duration_minutes, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into new_id;

  -- jsonb_to_recordset rather than a loop: one statement, and a malformed
  -- element fails the whole call rather than silently skipping one tag.
  if p_topics is not null and jsonb_typeof(p_topics) = 'array' then
    insert into public.os_ielts_practice_topic
      (practice_id, topic_slug, attempted, missed, severity)
    select new_id, t.slug, t.attempted, t.missed, t.severity
    from jsonb_to_recordset(p_topics)
      as t(slug text, attempted int, missed int, severity int);
  end if;

  return new_id;
end;
$$;

comment on function public.os_ielts_log_practice(
  text, text, date, boolean, int, numeric, int, text, jsonb) is
  'Writes one practice attempt and its weakness tags in a single transaction. SECURITY INVOKER on purpose: RLS still applies, so this grants atomicity and no authority. A partial write would produce a practice row that counts as practice but informs no weakness ratio.';

-- The owner's own requests arrive as `anon` carrying an x-app-key header, so
-- anon needs execute or the log form fails for the only user there is. This
-- is the 7 August 2026 lesson from docs/rls-conventions.md: "can reach" is
-- about the role the request actually arrives as, not the role it feels like.
revoke all on function public.os_ielts_log_practice(
  text, text, date, boolean, int, numeric, int, text, jsonb) from public;
grant execute on function public.os_ielts_log_practice(
  text, text, date, boolean, int, numeric, int, text, jsonb) to anon, authenticated;
