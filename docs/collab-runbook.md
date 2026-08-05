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

The one path in the whole feature that has never executed end to end:
`generateLink`'s output has never been consumed, and the gate's
`#collab_token` → `verifyOtp` handler has never succeeded once. Running it on
`https://personal-os.dikagustiana.com` (or `dika-personal-os.vercel.app`)
also closes the localhost caveat from the verification report — production
carries its own baked env vars, which a local run did not exercise.

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

Every verification across two slices used synthetic SQL identities and a
production bundle served from localhost. The following has **never executed
once**, and the surface riding on it has grown each slice: the panel's
project grants, `generateLink` output actually being consumed, the gate's
`#collab_token` → `verifyOtp` handler succeeding, the contributor project
card, the task list, the empty state, the assignee picker, and revoke
clearing **both** axes (behaviour that changed in slice 1 and has only been
tested in SQL).

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
