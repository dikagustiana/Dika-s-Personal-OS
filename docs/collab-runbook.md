# Collaborator access — owner runbook

Three closeout steps need the owner's credential or the dashboard, so they
cannot be executed by an agent session and are **outstanding until the owner
runs them**. Each has an expected result; if what you see differs, stop and
investigate before inviting anyone real.

## A. Disable the email/password provider

The app has no password path anywhere — the gate takes the passphrase or an
owner-handed link, and `provision-collaborator` neither sets nor accepts a
password (audited 2026-08-04). But the **provider** is still enabled at the
platform level, so `/auth/v1/token?grant_type=password` is reachable API
surface that never passes through owner provisioning.

1. Supabase dashboard → Authentication → Sign In / Up → Email: turn **off**
   password sign-in, keep the email provider itself available (magic-link /
   OTP verification is what `#collab_token` consumption uses).
2. Re-run the committed probe:

   ```bash
   bash scripts/probe-password-grant.sh
   ```

   - **Before the flip** (verified 2026-08-04):
     `{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}`
   - **After the flip, expected:** an error whose class says the provider or
     grant is disabled (e.g. `email_provider_disabled` /
     "Email logins are disabled") — anything but `invalid_credentials`.
3. Note for later verification passes: the retained test identity
   (`kucingkuroshiro+asi-selftest@gmail.com`, `encrypted_password` null,
   zero membership) can then **no longer** be signed in via password grant —
   which is fine; future verification should enter the same way collaborators
   do, via a provisioning link (see B).

## B. Run the positive provisioning path — on the production domain

> **Status 2026-08-05: the core of this is PROVEN.** A generated link was
> consumed on the production domain and the account carries a real
> `last_sign_in_at` — `generateLink` → `#collab_token` → `verifyOtp` works
> end to end. Still unwalked from the steps below: the second-use failure of
> a consumed link (step 3's tail), the `Tautan baru` (`link`) action, and
> the revoke-then-reload check (step 5) — those are folded into section E.

1. Owner session (passphrase) → Finish line → **Kolaborator** panel.
2. `Tambah kolaborator` → a fresh address you control → tick **one** entity →
   `Buat + hasilkan tautan`. Expected: a link appears with a copy button and
   the expiry note; `private.os_provision_log` gains a `create` row.
3. Copy the link. Open it in a **separate browser profile**. Expected: no
   passphrase prompt — the session lands directly in the matrix showing only
   that entity's column, with the Kolaborator badge and sign-out in the rail.
   Reloading the link a second time must **fail** (single-use) with the
   dead-link notice on the gate.
4. Back in the owner panel: the row now shows a last-sign-in timestamp.
   Press `Tautan baru` (the `link` action has never been run) — expected: a
   fresh link; consume it in the other profile after signing out there.
5. `Cabut` the address. Expected: the other profile's session reads zero on
   its next load (empty matrix, no projects), and the log gains a `revoke`
   row. The auth user remains in Authentication → Users.

## C. Decide on the overwritten note

`Sales — General Trade › ASI` had its note replaced during live verification
(history row at 2026-08-04 16:54) and the prior value was not captured —
that is exactly what migration `20260804000043` fixes for every write after
it. Recovery is not possible; a decision is:

- If that cell had a note you remember, re-enter it through the cell panel.
- If it was empty (most `input` cells are), confirm to yourself and move on —
  the cell currently reads `input` with an empty note, which is its restored
  pre-test state.

Either way the history chain stays honest: the pre-migration rows carry null
note columns, everything after carries full contents, and the standing chain
check in REVIEW.md returns zero rows.

## D. Walk the front door — slice 1 + the domain patch (OUTSTANDING, deferred twice)

> **Status 2026-08-05:** the magic-link half of this is proven (see B) and
> the grant path was REBUILT after the zero-grant incident — grants are now
> audited Edge-Function actions with a re-unlock banner on a dead session.
> What remains unwalked is the list below minus the link consumption; the
> two decisive steps are restated compactly in section E.

Every verification across two slices used synthetic SQL identities and a
production bundle served from localhost. The following has **never executed
once**, and the surface riding on it has grown each slice: the panel's
project grants, the contributor project card, the task list, the empty
state, the assignee picker, and revoke clearing **both** axes (now
server-side in one action, tested in SQL only).

Run on **`https://personal-os.dikagustiana.com`** (or
`dika-personal-os.vercel.app`) — the production domain, not localhost:

1. Owner session → collaborator panel → create with a fresh test address you
   control, grant entity `ASI` **and** one WORK project. Expected: the two
   grant sets render as **separate labelled rows** (Entitas / Proyek) —
   distinct chips, not one blended list.
2. Copy the link, open it in a separate browser profile. Expected: no
   passphrase prompt; the session lands signed in.
3. Confirm: the nav shows **Projects and Finish line only**; Projects lists
   **only the granted project**; the matrix shows **only ASI** cells.
4. Create a task, set a due date, assign it to yourself, and confirm it
   appears on the per-project timeline with the date.
5. Back in the owner session: confirm the task renders as
   **contributor-written** (the dot + attribution), and that an owner edit
   resets it to owner.
6. Confirm the granted project's card reads `dibagikan · 1` and an ungranted
   one reads `privat`.
7. Exercise `list` and `link` from the panel — **neither has ever run** end
   to end: the list should show the test account with its last sign-in, and
   `Tautan baru` should mint a link that works in the other profile.
8. Revoke, and confirm the still-open collaborator session reads **zero
   across projects, tasks, and cells** on its next load.
9. Confirm `private.os_provision_log` recorded every provisioning action
   (create / link / revoke rows).

If any step shows something other than expected, stop and investigate before
inviting anyone real. Bonus check while in the panel: the project picker
offers WORK projects only — and if a GROWTH id is ever forced past the UI,
the database refuses it (that part IS proven, in
`supabase/tests/collab_rls.sql`).

## E. The two steps that need the owner (2026-08-05) — everything else is done

After the zero-grant fix, both of these are one short action plus one look.
Fresh unlock first — the panel now tells you outright when its 12-hour
session has expired, with a **Buka kunci ulang** button; nothing silently
no-ops anymore.

### E1. Grant a project and watch it land

The entity axis and the magic link are proven; the project axis has **never
once worked end to end** — every prior attempt died before sending anything.

1. Owner session → Finish line → Kolaborator → on a collaborator's row press
   `+ beri akses proyek`, tick one or more projects (SAMB group on top;
   INTERNAL sits apart with a red label on purpose), press
   `Berikan akses (N)`.
2. **Expected:** the chips appear on the row immediately; in SQL,
   `select * from os_project_members` shows one row per ticked project and
   `select * from private.os_provision_log order by created_at desc limit 1`
   shows ONE `grant-projects` row carrying every ticked id; the granted
   project's card on the Projects page flips `privat` → `dibagikan · 1`.
3. In the collaborator's session (or after their next sign-in): Projects
   lists exactly the granted projects, with the task list open.

### E2. tteddy.suryadi@gmail.com has never signed in

A link was generated at creation but either not sent or already expired —
links are single-use and short-lived (~1 hour).

1. On that row press `Tautan baru`, copy the fresh link, and send it over
   WhatsApp yourself.
2. **Expected:** the panel shows the link with the expiry note and the log
   gains a `link` row (an action that has never run). After they open it:
   their row shows a `masuk …` timestamp, and they land on the ARBI column
   of the matrix — plus whatever projects E1 granted them.

## F. The grant model (2026-09-04) — APPLIED, and what changed

Collaborator access moved from "member of an entity" to
"(person, entity, section, capability)". **All four migrations are applied to
production and `provision-collaborator` is deployed at version 6.** The steps
below are kept as the record of what was done and what to check; nothing in
them is outstanding except the two items under "Still outstanding".

1. Apply `20260904000095_finish_line_grants` with the `apply_migration` tool
   (ledger name `finish_line_grants`). Read its NOTICE lines: one per member,
   with the cells they read before, after, and the parentless-metric cells
   that become owner-only (D4). Expected on live: 371 → 343, 371 → 343,
   265 → 245. Nothing else may be lost — the migration refuses otherwise.
2. Apply `20260904000096_provision_scope_audit` (ledger name
   `provision_scope_audit`). It gives the audit log the two scope actions.
3. Apply `20260904000097_finish_line_edges_follow_grants` (ledger name
   `finish_line_edges_follow_grants`): deps and edges follow the readable
   cells instead of the entity.
4. Apply `20260904000098_collab_link_status` (ledger name
   `collab_link_status`): the set-returning token reader behind the link
   status column. `os_collab_link_minted_at` stays.
5. **Only then** redeploy `provision-collaborator`. A build deployed before
   step 2 keeps every old action working and fails `grant-scope` /
   `revoke-scope` with "audit write failed" — loud, and fixed by step 2. A
   build deployed before step 4 reports link status from the filed rows
   alone and `unknown` where nothing was filed.
6. Run against live, all read-only or self-rolling-back:
   `supabase/tests/rls_function_grants.sql`, `anon_definer_gates.sql`,
   then `collab_rls.sql` (49 cases, everything inside it rolls back).
7. Open **Akses** in the sidebar. One row per collaborator, one column per
   (entity, section); every cell should read `W` for the people who were
   enrolled before the migration (the backfill), `—` under MAM and KGR, and
   the status column should agree with the Kolaborator panel's link line.
   Click one cell from `W` to `—` and back to `R` and then `W`: three
   audited rows appear in `private.os_provision_log` (`revoke-scope`,
   `grant-scope` read, `grant-scope` write) and the cell ends on `W`.
8. A contributor's matrix shows the cells their grants reach, and their
   account panel stops being empty (mapped accounts under readable cells,
   plus the entity's unmapped ones). On a section granted `read`, the cell
   panel shows the read-only sentence and no editors.

### What the apply actually measured (2026-09-04)

- 95 grant rows: 19 memberships × 5 sections, every one `write`, every one
  `created_by = 'backfill'`. Nobody lost a section they held.
- Readable cells per member: 371 → 343, 371 → 343, 265 → 245. That is the D4
  delta and nothing else — the migration's post-condition refuses to commit on
  any other loss, and it held. No account moved (zero accounts hang off a
  parentless metric).
- The four `require app key to …` policies on cells and accounts are
  byte-identical before and after.
- Against live afterwards: `rls_function_grants.sql` and
  `anon_definer_gates.sql` both zero rows, audit-inert floors intact (1036
  policy/role pairs).
- `provision-collaborator` v6 smoke-tested live: no `x-app-key` answers 401 on
  both an old action and `grant-scope` (the gate runs before the body),
  `OPTIONS` answers 200, `GET` answers 405.
- The frontend carrying the Akses view is on production: PR #102 merged as
  `8a23bb2`, and the live bundle answers with the same stamp
  (`curl` recipe in `deploy/README.md`), so the deploy was Vercel's own Git
  integration and not a manual upload.

### Still outstanding

1. **`COLLAB_LINK_TTL_SECONDS` is not set on the function.** Nothing reachable
   from an agent session sets function secrets: the Supabase MCP server
   exposes `deploy_edge_function`, `get_edge_function` and
   `list_edge_functions`, and nothing that writes an environment variable.
   Until the owner sets it, a live link reports `masa berlaku tidak diketahui`
   rather than inventing a countdown — that is the designed behaviour on an
   unset window, not a defect.

   **Do not guess the number.** It has to equal the project's own OTP window,
   or the column states a deadline GoTrue does not honour, and a link shown as
   live hours after it died is the exact failure this status exists to
   prevent. Read it at Authentication → Sign In / Up → Email → *Email OTP
   Expiration*, then add `COLLAB_LINK_TTL_SECONDS` with that number under
   Project Settings → Edge Functions → Secrets.

   It has never been set, and the value cannot be recovered from the data
   either: both rows of `os_collab_links` (minted 2026-08-11 and 2026-08-20)
   carry `expires_at = null`, which only happens when `linkTtlSeconds()`
   returns null. Confirm the fix on the Akses view — the unspent 20-August
   link should stop reading "masa berlaku tidak diketahui" and name an hour.
   If it still does not, redeploy the function once: a secret added after a
   deploy is not guaranteed to reach an instance that is already warm.

2. **`supabase/tests/collab_rls.sql` has not been run against live.** It is
   safe by construction — one transaction ending in `rollback` — but it makes
   real writes inside that transaction (synthetic `auth.users` rows, cell
   updates), and the MCP SQL tool's transaction semantics could not be
   verified from the agent session, so it was run on the throwaway cluster
   only (49 cases green). Run it by pasting the whole file into the SQL editor
   as `postgres` in one go, so the `rollback` is part of the same batch as the
   `begin`; zero rows expected.


What the owner should expect to see differently:

- Members no longer read the four parentless metrics (COGS / Sales × Poultry
  processing / Poultry trading). Owner-only until a migration gives those
  metrics a section.
- `create` for an existing address adds the entity **and** write grants on
  every section — and still mints a fresh link, which kills the one being
  held. To add an entity to someone without touching their link, use
  `grant-scope` (it enrols on the way in).
- `revoke` removes membership on both axes; the scope grants go with it
  through the cascading FK, and the response reports how many
  (`removedGrants`; null means the grants table was not readable).
