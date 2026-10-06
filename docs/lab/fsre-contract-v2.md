<!--
Ported verbatim from the GLM workspace (fsre-building, docs/contract-v2.md at commit 5b5d186).
In this repository the types live in src/data/fsreTransport/contract.ts (GLM: src/contract/v2.ts),
the vocabulary in src/logic/lab/fsre/statuses.ts (GLM: src/contract/vocabulary.ts), the provisional stage
list and the roster in src/data/fsreTransport/provisional.ts, and desk-state derivation in
src/logic/lab/fsre/deskState.ts. The open decisions are listed in docs/lab/fsre-building-v2-port.md.
-->

# Contract v2 — FSRE building ↔ agent runtime

This document and `src/contract/v2.ts` (the exact TypeScript twin) define what
the real backend — an agent runtime on a VPS writing to Supabase — must
produce. The current build runs entirely on `MockTransport`, which implements
this contract against synthetic data. The UI talks only to the `FsreTransport`
interface; the real transport drops in with no UI changes.

Conventions:

- All times are ISO 8601 strings in UTC (`at`, `createdAt`, `startedAt`,
  `statusAt`). They are required and never null. The UI renders them as
  HH.MM in the owner's local zone.
- Numbers are counts and references only. No share prices, no market data, no
  financial values in any payload. The UI formats counts in house format
  (45.996; 15,5%).
- Companies in the mock are fictitious (`SYNA`, `SYNB`, …). A real deployment
  carries real tickers; the UI shows the synthetic banner only in synthetic
  mode.
- Status vocabulary lives in `src/contract/vocabulary.ts`; stage names there
  are provisional (`STAGES_PROVISIONAL`) until the router's real state
  machine replaces them.

---

## Roster

| Floor | Unit | Lead | Staff |
|---|---|---|---|
| B1 | Data department | Data lead: `idx-universe`, `data-sourcing` | One per company in active engagements, minimum 2: `fs-intake`, `fs-normalize` |
| 1F | Lobby (not a department) | Router: `fs-reverse-engineering`, at reception | Methodology: `guruh`, in the training room |
| 2F | Modelling department | Modelling lead: `peer-benchmark`, archetype choice | One per company, minimum 2: `fs-driver-decomposition`, `financial-modeling` |
| 3F | Review department | Review lead: `review-manager`, decides gates | Tie-out checker; source-trace checker |
| 4F | Partner room | Owner (human) | — |

A lead assigns work, does a first-line check before handing work to the next
floor, and keeps the two companies in a pair mapped the same way (company A
to the first staff desk, company B to the second, consistently). A lead does
not decide gates; only the review lead does.

## Interface — `FsreTransport`

| Method | Purpose |
|---|---|
| `subscribeEvents(cb)` | Stream of `AgentEvent`. The building is a pure function of this stream plus the clock. Unsubscribe by calling the returned function. |
| `listAgents()` | The roster (see Roster). Staff appear and disappear as engagements start and end. |
| `listEngagements()` | All engagements with their plans and statuses. |
| `proposeEngagement(requestedText)` | Free text from the owner (ticker or company name). Returns an `Engagement` whose `plan` may be blocked. |
| `startEngagement(id)` | Assigns staff and starts the run. Refuses blocked engagements. |
| `cancelEngagement(id)` | Cancels; staff are unassigned if no other live engagement uses their company. |
| `sendCommand(draft)` | Sends a command to one agent. The recipient's lead is added to `ccAgentIds` automatically by the backend. |
| `listCommands(filter)` | Command history, filterable by agent and engagement. |
| `getIndustryProgress()` | The industries board: one row per sub-industry. |
| `approveVersion(engagementId, version)` | Owner only. Refused while any escalation on that version is open, with `lockedReason`. |

---

## Entities, one JSON example each

### `Agent`

```json
{
  "id": "data-staff-a",
  "role": "staff",
  "departmentId": "data",
  "title": "Data staff",
  "skills": ["fs-intake", "fs-normalize"],
  "assignedTicker": "SYNA"
}
```

`role` is `lead` | `staff` | `router` | `methodology` | `owner`.
`departmentId` is `data` | `modelling` | `review`, or `null` for the router,
methodology and owner (the lobby and partner room are not departments).

### `Engagement` (with its `EngagementPlan`)

```json
{
  "id": "eng-syn-cem-1",
  "requestedText": "Model the synthetic cement pair for wave 1",
  "plan": {
    "subIndustryCode": "SYN-CEM",
    "subIndustryName": "Synthetic cement",
    "chainNodeId": "chain-2",
    "tickers": ["SYNA", "SYNB"],
    "archetype": { "id": "ARC-PROC", "status": "available" },
    "conflictCheck": { "result": "clear", "reason": null },
    "filingsFound": [
      { "docId": "SYNA-FY2025-A", "period": "FY2025", "kind": "Annual report" }
    ],
    "blockedReasons": []
  },
  "status": "running",
  "createdAt": "2026-10-06T09:00:00.000Z",
  "startedAt": "2026-10-06T09:00:00.000Z"
}
```

`status` is `proposed` | `blocked` | `running` | `waiting_owner` | `returned`
| `published` | `cancelled`. `blockedReasons` is empty exactly when the
engagement can start. `archetype.status` is `available` or `missing`;
`missing` is a blocked reason ("Archetype not built yet"). A sub-industry
with one listed company is blocked ("Peer pair needs 2 companies"). A ticker
on the conflict list makes `conflictCheck.result` `excluded` with the reason,
and is also a blocked reason. `chainNodeId` is `null` when the sub-industry
is not placed on the chain yet.

### `Command`

```json
{
  "id": "cmd-7",
  "at": "2026-10-06T09:12:03.000Z",
  "toAgentId": "review-lead",
  "ccAgentIds": [],
  "engagementId": "eng-syn-cem-1",
  "kind": "override",
  "text": "Use the flag-only treatment for the missed SYNA periods",
  "reason": "The two missed periods are immaterial; flag them.",
  "status": "done",
  "statusAt": "2026-10-06T09:12:09.000Z",
  "response": "Recorded in the workpaper as Owner instruction, 6 Oct 2026.",
  "declinedRule": null,
  "workpaperNote": "Owner instruction, 6 Oct 2026"
}
```

`kind` is `instruction` | `question` | `override`; an override requires
`reason` and carries `workpaperNote`. `status` follows
`sent` → `received` → `done` | `declined`. `ccAgentIds` is the recipient's
department lead, added by the backend; there is no Cc when the recipient is a
lead, the router or methodology. A declined command carries `declinedRule`
(`R1_HOLDOUT` | `R2_GATE_BYPASS` | `R3_APPROVAL`) and a one-line plain
explanation in `response`. These rules are placeholders in the mock; real
enforcement lives in the backend.

### `AgentEvent`

```json
{
  "id": "evt-42",
  "seq": 42,
  "at": "2026-10-06T09:04:18.000Z",
  "agentId": "data-staff-a",
  "engagementId": "eng-syn-cem-1",
  "ticker": "SYNA",
  "stageId": "intake",
  "type": "action",
  "summary": "Mapping cost-of-revenue note, row 14 of 37",
  "sourceRef": { "docId": "SYNA-FY2025-A", "page": 14, "note": "Cost of revenue" },
  "counts": { "rowsMapped": 14, "rowsTotal": 37 },
  "waitingOn": null,
  "commandId": null,
  "escalationId": null
}
```

`type` is one of `task_started`, `action`, `task_done`, `handoff`, `waiting`,
`heartbeat`, `escalation_opened`, `escalation_closed`, `gate_result`,
`command_received`, `command_done`, `command_declined`. `summary` is plain
words describing what the agent did — no financial values. `counts` carries
numbers only (`rowsMapped`, `rowsTotal`, `checksPassed`, `gatesFailed`, …).
`seq` is monotonically increasing per stream.

Event semantics the UI relies on:

- `task_started` / `task_done` bracket one task on one desk. An open task
  without a `task_done` is what makes a desk read "Working".
- `waiting` carries `waitingOn` (an agent id); it makes the desk read
  "Waiting".
- `heartbeat` is a transport keep-alive. It is ignored by desk-state
  derivation: it must never make a desk read "Working" or stop
  "No signal".
- `escalation_opened` / `escalation_closed` carry `escalationId`; while any
  escalation on a version is open, approval of that version is locked.
- `gate_result` carries the gate stage in `stageId` (`gate-1`, `gate-2`,
  `gate-3`) and its verdict in `counts`: `gatesFailed` = 1 means failed, 0
  means passed. A passed gate with an open escalation on the same ticker and
  gate stage displays as `passed_with_open_escalations`.

### `IndustryProgressRow`

```json
{
  "subIndustryCode": "SYN-CEM",
  "subIndustryName": "Synthetic cement",
  "chainGroup": "Basic industry",
  "chainOrder": 2,
  "targetCompanies": 2,
  "companies": [
    {
      "ticker": "SYNA",
      "engagementId": "eng-syn-cem-1",
      "stageIndex": 7,
      "stagesTotal": 13,
      "gates": { "g1": "passed", "g2": "passed_with_open_escalations", "g3": "pending" },
      "escalationsOpen": 1,
      "publishedVersion": null
    }
  ],
  "covered": false
}
```

`chainGroup` is one of, in chain order: Raw-material extraction; Basic
industry; Processing industry; Distribution; Sales channels; End users;
Spanning layers — Energy; Spanning layers — Logistics; Not placed on the
chain yet. `chainOrder` is `null` for the last group. `covered` is true only
when at least 2 companies in the row have a `publishedVersion`. `stageIndex`
is the highest stage order reached (1-based; 0 = not started), never a
percentage.

---

## Desk-state derivation (implemented in `src/derive/deskState.ts`)

A desk's state is a pure function of the agent's event stream and the current
time, in this fixed precedence:

1. `escalated` — any open escalation on the agent's work.
2. `no_signal` — an open task and no signal (any event except `heartbeat`)
   for `NO_SIGNAL_AFTER_MIN` (default 5) minutes. The desk shows
   "No signal since HH.MM" with the time of the last signal. An open task
   with no received event at all cannot prove silence and stays in a lower
   state.
3. `waiting` — the latest task event is `waiting` with `waitingOn` set.
4. `working` — an open task.
5. `idle` — everything else. A desk with no agent assigned shows
   "Idle, no assignment".

## Decisions for the owner to confirm

1. **Gate verdict in `counts`.** The contract has no dedicated verdict field
   on `AgentEvent`, so `gate_result` carries `gatesFailed` (0 or 1) in
   `counts`, and `passed_with_open_escalations` is derived from open
   escalations sharing ticker + gate stage. If the real runtime prefers an
   explicit field, `AgentEvent` needs one more property.
2. **`heartbeat` ignored for desk state.** Heartbeats prove transport life,
   not task life; they neither make a desk "Working" nor stop "No signal".
3. **Versions.** An engagement produces one version string (e.g. `v1`);
   `approveVersion` publishes it for every company in the engagement's pair
   and sets `publishedVersion` on the matching industry rows.
4. **Publishing is visible through events.** After a successful
   `approveVersion` the backend should emit a `task_done` event on the owner
   agent so live UIs update without polling.
5. **`returned` status** is reserved (an owner returning work to a
   department) and unused by the mock.
