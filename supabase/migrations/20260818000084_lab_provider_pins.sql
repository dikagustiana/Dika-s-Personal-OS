-- =============================================================================
-- LAB PROVIDER PINS: DeepSeek and Kimi rows repointed at documented model IDs
-- with vendor-current prices. The seeded strings were dead or stale.
-- =============================================================================
--
-- APPLIED 2026-08-18 via the Supabase apply_migration tool (ledger name
-- `lab_provider_pins`). Verified live after applying: both rows read back
-- with the new model strings and rates; the 1.14 pin guard accepted both
-- (digit-bearing documented IDs) and was separately confirmed still to
-- refuse an alias — an UPDATE probe setting model='deepseek-chat' failed
-- with the pin message inside a rolled-back transaction. The anthropic row
-- was NOT touched (owner's call, 2026-08-18: "don't use claude" — the row
-- keeps its valid dated pin, no key is set, internal agents stay dormant;
-- the data boundary is unchanged and non-negotiable). Never `supabase db
-- push` / `migration up` / `db reset` — see 20260817000073.
--
-- Down-migration: down/20260818000084_lab_provider_pins_down.sql (restores
-- the prior strings; it must step around the pin guard for deepseek-chat,
-- because the old value is exactly the alias the guard now refuses).
--
-- WHY EACH CHANGE:
--
--  deepseek  `deepseek-chat` was retired by the vendor on 2026-07-24 — it
--            was a mutable alias, not a model, and calls stopped resolving.
--            This is the failure mode 1.14 was written against, and the
--            lesson WIDENS the rule: the forbidden thing is not the word
--            `latest`, it is ANY mutable alias — `deepseek-chat` contained
--            no forbidden word and still broke. The mechanical guard (no
--            'latest', must carry a digit) already refuses this exact
--            string on any future edit; the discipline — a documented
--            model ID, never an alias — is recorded in TODO.md because no
--            trigger can know a vendor's catalogue.
--            New pin: `deepseek-v4-pro` (owner chose the flagship tier,
--            2026-08-18). The vendor's docs state this documented ID
--            serves dated builds underneath (V4-Pro-0813 at the time of
--            writing) — that is the vendor's contract to keep, and fine.
--
--            PRICES ARE THE PEAK RATE, DELIBERATELY. DeepSeek moved to
--            peak/off-peak pricing effective 2026-08-16 16:00 UTC:
--            peak $1.32 in / $3.96 out per Mtok (01:00–04:00 and
--            06:00–10:00 UTC), off-peak half that. cost_in_per_mtok is a
--            single number, so it holds the PEAK rate: it over-states cost
--            rather than under-stating it, and a cost figure quietly too
--            low is worse than one honestly too high. Recorded in TODO.md
--            with the windows written out. Source: vendor announcement as
--            carried by multiple independent outlets on 2026-08-13..17;
--            the vendor's own price table is client-rendered and was not
--            machine-readable from the build environment — noted, not
--            hidden.
--
--  kimi      `kimi-k2-0905-preview` is no longer in the vendor catalogue
--            (Moonshot has been retiring dated preview IDs; the platform
--            now lives at platform.kimi.ai). New pin: `kimi-k3` (owner
--            chose the flagship, knowing it prices at Sonnet parity).
--            $3.00 in / $15.00 out per Mtok, read off the vendor's own
--            pricing page (platform.kimi.ai/docs/pricing/chat-k3,
--            2026-08-18; cache-hit input $0.30 exists but the schema
--            carries one input rate — the cache-miss rate, same
--            over-state-not-under-state rule). Base URL stays
--            https://api.moonshot.ai/v1 — the vendor's OpenAPI spec still
--            names it as the sole production server despite the docs-site
--            rename.

update public.os_lab_providers
   set model = 'deepseek-v4-pro',
       cost_in_per_mtok = 1.32,
       cost_out_per_mtok = 3.96
 where name = 'deepseek';

update public.os_lab_providers
   set model = 'kimi-k3',
       cost_in_per_mtok = 3.00,
       cost_out_per_mtok = 15.00
 where name = 'kimi';
