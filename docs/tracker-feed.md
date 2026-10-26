# Tracker feed — the SAMB Project Board inside WORK › Today

Decisions: D-29 (read the board in Today), D-30 (merge it into WORK tasks so
the desktop island shows it). Nothing here ever writes to the board.

## Path

```
TrackerFeedCard (WORK › Today)
  → POST {VITE_SUPABASE_URL}/functions/v1/tracker-feed   x-app-key: passphrase key
      → GET  TRACKER_FEED_URL                             x-feed-token: TRACKER_FEED_TOKEN
          (board: supabase/functions/personal-feed, src/data/feed.ts)
```

The board's answer: `{person, today, prepare[], review[], monitor[]}`, each
item `{key, kind, ref, title, project, detail, date, url}`.
`src/data/trackerFeed.ts` checks it before rendering: rows missing a field,
or whose `url` is not https, are dropped.

| Group | On the board |
|---|---|
| Prepare | Kerja saya, commits, rework, packages and gates to resend |
| Review | validate, sign off, decide gates and Keputusan, close, unblock |
| Monitor | Menunggu orang lain, plus late work of others in projects the owner leads |

## Sync into WORK tasks (D-30)

`public.os_tracker_sync(feed)` (migration `20261026000111_tracker_sync`)
merges the feed, one task per item key (`payload.tracker.key`):

| Case | Result |
|---|---|
| new item | WORK task, priority `normal`, tag `tracker`, title `Prepare · MB02 …`; due date = the item's date for Prepare/Review, none for Monitor |
| item still there, task open | title, due date and `payload.tracker` follow the board; anything the owner added (priority, project, goal) stays |
| task ticked by the owner | stays done (hidden); the board is not touched |
| item gone from the feed | task done, `payload.tracker.closed = true`; reopens if the item comes back |

Who runs it: `tracker-feed` after each read (opening Today), and
`tracker-sync` every 15 minutes via pg_cron job `tracker-sync`
(`private.os_tracker_sync_invoke`, Vault secrets `tracker_sync_url` and
`tracker_sync_token`).

## Setup (once)

1. Board side: its `docs/deploy.md` §23 (migration, `personal-feed` function,
   mint a token labelled `personal-os`).
2. Here, as Edge Function secrets of this project:
   - `TRACKER_FEED_URL` = `https://<board-ref>.supabase.co/functions/v1/personal-feed`
   - `TRACKER_FEED_TOKEN` = the minted token
3. Deploy `tracker-feed` (verify_jwt on, like `fsre-events`: the anon key
   passes the gateway, the passphrase key is the credential) and
   `tracker-sync` (verify_jwt off: the Vault token is the credential).
4. Vault, once in the SQL editor:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/tracker-sync', 'tracker_sync_url');
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'tracker_sync_token');
   ```

   Check a run: `select private.os_tracker_sync_invoke();`, then
   `select status_code, content from net._http_response order by id desc limit 1;`.

## Failure states the card shows

| reason | Meaning |
|---|---|
| `not-configured` | a secret is missing |
| `tracker-refused` | the board said 401/404: token revoked or the person removed |
| `tracker-unreachable` | the board did not answer in 15 s |
| `Unauthorized` / `Locked out` | the passphrase key is missing or wrong |

## Revoking

Board SQL editor: `select private.feed_token_revoke('personal-os');`. Mint a
new one and replace `TRACKER_FEED_TOKEN`.
