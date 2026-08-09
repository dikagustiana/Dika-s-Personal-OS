/**
 * §3 from the trail's side. Three questions, and the third is the one that
 * costs something if it regresses:
 *
 *   1. Do the four sources merge into ONE time-ordered list for ONE person?
 *   2. Is a reference that cannot be translated SHOWN rather than dropped?
 *   3. Can an owner edit ever be attributed to a collaborator? (No, and the
 *      reason is structural: the owner has no actor id to match against.)
 *
 * The migration block at the bottom is the evidence §3.5 asks for in writing —
 * the three history tables' actor definitions side by side, and the proof that
 * neither new migration adds an UPDATE or DELETE policy anywhere.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCellLabels,
  buildCollaboratorActivity,
  buildProcessRowLabels,
  buildTaskLabels,
  countUnattributedTextEdits,
  type ActivitySources,
} from './collaboratorActivity';
import type {
  CellHistoryEntry,
  FinishLineCell,
  FinishLineItem,
  ProcessTextHistoryEntry,
  ProjectTask,
  TaskHistoryEntry,
} from '../data/types';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const HER = '11111111-1111-4111-8111-111111111111';
const HIM = '22222222-2222-4222-8222-222222222222';

const CELL: CellHistoryEntry = {
  id: 'ch-1',
  cellId: 'cell-a',
  fromState: 'input',
  toState: 'figure',
  noteChanged: false,
  actorKind: 'contributor',
  actor: HER,
  changedAt: '2026-08-07T04:20:00.000Z',
};

const TASK: TaskHistoryEntry = {
  id: 'th-1',
  taskId: 'task-a',
  field: 'status',
  fromValue: 'todo',
  toValue: 'doing',
  actorKind: 'contributor',
  actor: HER,
  changedAt: '2026-08-07T05:00:00.000Z',
};

const TEXT: ProcessTextHistoryEntry = {
  id: 'tx-1',
  tableName: 'os_process_steps',
  rowId: 'step-a',
  field: 'name',
  actorKind: 'contributor',
  actor: HER,
  changedAt: '2026-08-07T03:00:00.000Z',
};

const EMPTY: ActivitySources = {
  signIns: [],
  cellHistory: [],
  taskHistory: [],
  textHistory: [],
};

const NO_LABELS = { cells: new Map(), tasks: new Map(), processRows: new Map() };

const LABELS = {
  cells: new Map([['cell-a', 'Storing cost · SAMB']]),
  tasks: new Map([['task-a', 'Tutup buku Juli']]),
  processRows: new Map([['os_process_steps:step-a', 'S9 Terima barang · SAMB']]),
};

describe('four sources become one trail for one person', () => {
  it('merges all four and orders them newest first', () => {
    const events = buildCollaboratorActivity(
      HER,
      {
        signIns: [{ userId: HER, signedInAt: '2026-08-07T04:17:00.000Z' }],
        cellHistory: [CELL],
        taskHistory: [TASK],
        textHistory: [TEXT],
      },
      LABELS,
    );
    expect(events.map((event) => event.kind)).toEqual(['task', 'cell', 'sign-in', 'text']);
    expect(events.map((event) => event.at)).toEqual([
      '2026-08-07T05:00:00.000Z',
      '2026-08-07T04:20:00.000Z',
      '2026-08-07T04:17:00.000Z',
      '2026-08-07T03:00:00.000Z',
    ]);
  });

  it('reads the resolved label, not the id, when one exists', () => {
    const events = buildCollaboratorActivity(HER, { ...EMPTY, cellHistory: [CELL] }, LABELS);
    expect(events[0].subject).toBe('Storing cost · SAMB');
    expect(events[0].detail).toBe('input → figure');
    expect(events[0].unresolved).toBe(false);
  });

  it('says "catatan diubah" when only the note moved', () => {
    const noteOnly: CellHistoryEntry = {
      ...CELL,
      fromState: 'figure',
      toState: 'figure',
      noteChanged: true,
    };
    const events = buildCollaboratorActivity(HER, { ...EMPTY, cellHistory: [noteOnly] }, LABELS);
    expect(events[0].detail).toBe('catatan diubah');
  });

  it('gives another person nothing of hers', () => {
    const events = buildCollaboratorActivity(
      HIM,
      { signIns: [{ userId: HER, signedInAt: '2026-08-07T04:17:00.000Z' }], cellHistory: [CELL], taskHistory: [TASK], textHistory: [TEXT] },
      LABELS,
    );
    expect(events).toEqual([]);
  });
});

describe('an unresolvable reference is shown, never hidden', () => {
  it('keeps the row and carries the raw table and id', () => {
    const orphan: ProcessTextHistoryEntry = {
      ...TEXT,
      tableName: 'os_process_lanes',
      rowId: 'lane-that-no-longer-exists',
    };
    const events = buildCollaboratorActivity(HER, { ...EMPTY, textHistory: [orphan] }, LABELS);
    expect(events).toHaveLength(1);
    expect(events[0].unresolved).toBe(true);
    expect(events[0].subject).toBe('os_process_lanes · lane-that-no-longer-exists');
  });

  it('keeps cell and task rows too when their label is missing', () => {
    const events = buildCollaboratorActivity(
      HER,
      { ...EMPTY, cellHistory: [CELL], taskHistory: [TASK] },
      NO_LABELS,
    );
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.unresolved)).toBe(true);
    expect(events.map((event) => event.subject)).toContain('sel cell-a');
    expect(events.map((event) => event.subject)).toContain('task task-a');
  });
});

describe('the owner is structurally unattributable, and that is the point', () => {
  it('never matches a collaborator, because an owner row carries no actor', () => {
    const ownerEdit: CellHistoryEntry = { ...CELL, actorKind: 'owner', actor: null };
    expect(buildCollaboratorActivity(HER, { ...EMPTY, cellHistory: [ownerEdit] }, LABELS)).toEqual(
      [],
    );
    expect(buildCollaboratorActivity(HIM, { ...EMPTY, cellHistory: [ownerEdit] }, LABELS)).toEqual(
      [],
    );
  });

  it('counts pre-migration-69 text rows instead of guessing an actor for them', () => {
    const preMigration: ProcessTextHistoryEntry = { ...TEXT, actorKind: null, actor: null };
    expect(countUnattributedTextEdits([preMigration, TEXT])).toBe(1);
    // And it belongs to nobody, so it appears in nobody's trail.
    expect(
      buildCollaboratorActivity(HER, { ...EMPTY, textHistory: [preMigration] }, LABELS),
    ).toEqual([]);
  });
});

describe('label indexes', () => {
  const items: FinishLineItem[] = [
    { id: 'item-a', item: 'Storing cost', kind: 'metric', order: 1 },
  ];
  const cells: FinishLineCell[] = [
    { id: 'cell-a', itemId: 'item-a', entityCode: 'SAMB', state: 'figure' },
    { id: 'cell-b', itemId: 'item-missing', entityCode: 'ARBI', state: 'input' },
  ];

  it('pairs the row label with the entity, because neither alone identifies a cell', () => {
    const labels = buildCellLabels(cells, items);
    expect(labels.get('cell-a')).toBe('Storing cost · SAMB');
  });

  it('registers no label at all for a cell whose item is gone', () => {
    expect(buildCellLabels(cells, items).has('cell-b')).toBe(false);
  });

  it('indexes tasks by id', () => {
    const tasks = [{ id: 'task-a', title: 'Tutup buku Juli' }] as ProjectTask[];
    expect(buildTaskLabels(tasks).get('task-a')).toBe('Tutup buku Juli');
  });

  it('indexes lanes under both the bare key and the composite', () => {
    const labels = buildProcessRowLabels({
      steps: [],
      needs: [],
      gates: [],
      lanes: [
        { entityCode: 'SAMB', key: 'WAREHOUSE', label: 'Gudang', ordinal: 1, isExternal: false },
      ],
      phases: [],
    });
    expect(labels.get('os_process_lanes:WAREHOUSE')).toBe('Gudang · SAMB');
    expect(labels.get('os_process_lanes:SAMB/WAREHOUSE')).toBe('Gudang · SAMB');
  });
});

// --- the migration evidence §3.5 asks for -----------------------------------

describe('§3.5.1 the three history tables agree on the actor pair', () => {
  const cellSql = read('supabase/migrations/20260804000039_cell_attribution.sql');
  const taskSql = read('supabase/migrations/20260804000046_tasks_with_history.sql');
  const textSql = read('supabase/migrations/20260809000069_text_history_actor.sql');

  it('os_finish_line_cell_history: actor_kind text NOT NULL, actor uuid NULL', () => {
    const body = cellSql.slice(cellSql.indexOf('create table if not exists public.os_finish_line_cell_history'));
    expect(body).toMatch(/actor_kind\s+text not null/);
    expect(body).toMatch(/actor\s+uuid\s*,/);
  });

  it('os_task_history: the same pair, same types, same nullability', () => {
    const body = taskSql.slice(taskSql.indexOf('create table if not exists public.os_task_history'));
    expect(body).toMatch(/actor_kind\s+text not null/);
    expect(body).toMatch(/actor\s+uuid\s*,/);
  });

  it('os_process_text_history: text + uuid, and actor_kind becomes NOT NULL', () => {
    expect(textSql).toMatch(/add column if not exists actor_kind text/);
    expect(textSql).toMatch(/add column if not exists actor\s+uuid/);
    expect(textSql).toMatch(/alter column actor_kind set not null/);
    // NOT a third variant: actor stays nullable, exactly like the other two.
    expect(textSql).not.toMatch(/actor\s+uuid not null/);
  });

  it('constrains actor_kind to the same two values the cell table does', () => {
    expect(cellSql).toContain("check (actor_kind in ('owner', 'contributor'))");
    expect(textSql).toContain("check (actor_kind in ('owner', 'contributor'))");
  });
});

describe('§3.5.2 the text history stays append-only', () => {
  const sql = read('supabase/migrations/20260809000069_text_history_actor.sql');

  it('adds no policy of any kind — the two from 55 are all there are', () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/for\s+update/i);
    expect(sql).not.toMatch(/for\s+delete/i);
  });

  it('stamps the actor server-side and never accepts one from the client', () => {
    expect(sql).toContain('before insert on public.os_process_text_history');
    expect(sql).toContain('security definer');
    expect(sql).toMatch(/new\.actor_kind := 'owner'/);
    expect(sql).toMatch(/new\.actor := null/);
    expect(sql).toMatch(/new\.actor_kind := 'contributor'/);
  });

  it('raises rather than inventing an actor when there is none', () => {
    expect(sql).toMatch(/raise exception[\s\S]*?no identifiable actor/);
  });

  it('ships a down migration that drops the trigger before the column', () => {
    const down = read('supabase/migrations/down/20260809000069_text_history_actor_down.sql');
    expect(down.indexOf('drop trigger')).toBeLessThan(down.indexOf('drop column'));
    expect(down).not.toMatch(/create policy/i);
  });
});

describe('§3.5.4 the sign-in log stores who and when, and nothing else', () => {
  const sql = read('supabase/migrations/20260809000070_sign_in_log.sql');
  const table = sql.slice(
    sql.indexOf('create table if not exists public.os_sign_in_log'),
    sql.indexOf('comment on table'),
  );

  it('has exactly a surrogate key, a user and a timestamp', () => {
    expect(table).toMatch(/user_id\s+uuid\s+not null/);
    expect(table).toMatch(/signed_in_at timestamptz not null/);
  });

  it('records no ip, user agent, location or device profile', () => {
    for (const banned of [
      'ip_address',
      'ip ',
      'user_agent',
      'useragent',
      'location',
      'country',
      'city',
      'device',
      'fingerprint',
      'session_id',
    ]) {
      expect(table.toLowerCase()).not.toContain(banned);
    }
  });

  it('adds no view, click, duration or navigation tracking', () => {
    // Executable SQL only. The header prose says these are deliberately NOT
    // recorded, and a scan that read the documentation would fail on the
    // sentence promising the absence.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .replace(/comment on[\s\S]*?';/g, '')
      .toLowerCase();
    for (const banned of ['viewed', 'page_view', 'clicked', 'duration', 'dwell', 'navigat']) {
      expect(statements).not.toContain(banned);
    }
  });

  it('is owner-only: one select policy, no insert, no update, no delete', () => {
    const policies = [...sql.matchAll(/create policy\s+"([^"]+)"[\s\S]*?for\s+(\w+)/g)].map(
      (match) => match[2],
    );
    expect(policies).toEqual(['select']);
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('(select public.os_key_valid())');
  });

  it('is fed by a trigger on auth.users, so a client cannot skip it', () => {
    expect(sql).toContain('after insert or update of last_sign_in_at on auth.users');
    expect(sql).toContain('security definer');
    expect(sql).toMatch(/new\.last_sign_in_at is distinct from old\.last_sign_in_at/);
  });

  it('can never block a sign-in: the insert swallows its own exceptions', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.os_record_sign_in'));
    expect(fn).toMatch(/exception\s+when others then/);
  });

  it('ships a down migration that drops the trigger first', () => {
    const down = read('supabase/migrations/down/20260809000070_sign_in_log_down.sql');
    expect(down.indexOf('drop trigger')).toBeLessThan(down.indexOf('drop table'));
  });
});

describe('§3.5 neither migration touches the tables that must not move', () => {
  const files = [
    'supabase/migrations/20260809000069_text_history_actor.sql',
    'supabase/migrations/20260809000070_sign_in_log.sql',
  ];

  it('leaves os_finish_line_*, os_entity_members and the process content alone', () => {
    for (const file of files) {
      const statements = read(file)
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .replace(/comment on[\s\S]*?';/g, '');
      expect(statements).not.toMatch(/\b(?:alter|drop|truncate) table[^\n]*os_finish_line/);
      expect(statements).not.toMatch(/os_entity_members/);
      expect(statements).not.toMatch(/\bupdate\s+public\.os_process/);
      expect(statements).not.toMatch(/\bdelete from\b/);
    }
  });
});
