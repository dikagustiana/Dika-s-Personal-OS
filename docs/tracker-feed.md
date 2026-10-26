# Tracker feed — the SAMB Project Board inside WORK › Today

Decision: D-29. Read-only, both ways: nothing here writes to the board, and
nothing from the board is stored here.

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

## Setup (once)

1. Board side: its `docs/deploy.md` §23 (migration, `personal-feed` function,
   mint a token labelled `personal-os`).
2. Here, as Edge Function secrets of this project:
   - `TRACKER_FEED_URL` = `https://<board-ref>.supabase.co/functions/v1/personal-feed`
   - `TRACKER_FEED_TOKEN` = the minted token
3. Deploy `tracker-feed` (verify_jwt on, like `fsre-events`: the anon key
   passes the gateway, the passphrase key is the credential).

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
