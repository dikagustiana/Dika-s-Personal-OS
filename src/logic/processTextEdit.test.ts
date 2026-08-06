/**
 * §C, the half that is decidable without a browser: the parsers, the audit
 * diff, and the two structural guarantees that live in files rather than in
 * behaviour — the write types' key sets, and migration 20260806000055's
 * policy set.
 *
 * The parser tests are the ones worth reading. `docs`, `drivers` and `coa`
 * are edited one item per line, and the natural implementation drops what it
 * cannot parse. That is silent data loss: the user saves, the malformed line
 * disappears, and nothing anywhere says so. Every assertion below about
 * `ok: false` is really an assertion that the save STOPS — see
 * processTextEditing.test.tsx for the other end of that, where a rejected
 * parse leaves the textarea untouched and the repository uncalled.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NEED_KINDS,
  NEED_STATUSES,
  diffForHistory,
  formatCoaList,
  formatLineList,
  isDirty,
  parseCoaList,
  parseLineList,
  type ProcessGateTextWrite,
  type ProcessLaneTextWrite,
  type ProcessNeedTextWrite,
  type ProcessPhaseTextWrite,
  type ProcessStepTextWrite,
} from './processTextEdit';
import { fixtureSteps } from './process/seedFixture';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

// --- the list parsers -------------------------------------------------------

describe('§C.4 coa parses `kode | keterangan`, and REJECTS rather than drops', () => {
  it('accepts the well-formed case and trims both halves', () => {
    const result = parseCoaList('6.3.01 | Storing — Manpower\n  6.3.02|Storing — Sewa  ');
    expect(result).toEqual({
      ok: true,
      value: [
        { code: '6.3.01', label: 'Storing — Manpower' },
        { code: '6.3.02', label: 'Storing — Sewa' },
      ],
    });
  });

  it('a line with no "|" fails, and the message names the line the user sees', () => {
    const result = parseCoaList('6.3.01 | Storing\n6.3.02 tanpa pemisah\n6.3.03 | Sewa');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[0].message).toContain('Baris 2');
    expect(result.errors[0].message).toContain('tidak ada tanda "|"');
  });

  it('a blank line in the middle is skipped, and does NOT shift the numbering', () => {
    // The blank is line 2; the bad line is line 3 as the person counts it,
    // not line 2 as a filtered array would.
    const result = parseCoaList('6.3.01 | Storing\n\nrusak\n\n6.3.03 | Sewa');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.map((error) => error.line)).toEqual([3]);
    // And a blank-only body is a legitimate empty list, not an error.
    expect(parseCoaList('\n  \n\n')).toEqual({ ok: true, value: [] });
  });

  it('reports EVERY bad line at once — fixing them one round trip at a time is its own punishment', () => {
    const result = parseCoaList(
      ['rusak satu', '6.3.01 | Storing', 'juga rusak', '| tanpa kode', '6.3.02 |'].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors.map((error) => error.line)).toEqual([1, 3, 4, 5]);
    expect(result.errors[2].message).toContain('kode kosong');
    expect(result.errors[3].message).toContain('keterangan kosong');
  });

  it('a second "|" is a failure, not a silent join — the label is ambiguous', () => {
    const result = parseCoaList('6.3.01 | Storing | Manpower');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0].message).toContain('lebih dari satu');
  });

  it('carries NO partial value on failure — a half-parsed list must be unreachable', () => {
    const result = parseCoaList('6.3.01 | Storing\nrusak');
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
  });

  it('round-trips every coa entry in the SAMB seed unchanged', () => {
    const entries = fixtureSteps().flatMap((step) => step.coa);
    expect(entries.length).toBeGreaterThan(40);
    const result = parseCoaList(formatCoaList(entries));
    expect(result).toEqual({ ok: true, value: entries });
  });
});

describe('§C.4 docs and drivers are one item per line, nothing more', () => {
  it('trims, drops blanks, and keeps order', () => {
    expect(parseLineList('  DO fisik \n\n GR sistem\n')).toEqual({
      ok: true,
      value: ['DO fisik', 'GR sistem'],
    });
  });

  it('does not treat "|" as structure here — a doc name may contain one', () => {
    expect(parseLineList('WMS | modul inbound')).toEqual({
      ok: true,
      value: ['WMS | modul inbound'],
    });
  });

  it('round-trips every docs and drivers list in the SAMB seed', () => {
    for (const step of fixtureSteps()) {
      expect(parseLineList(formatLineList(step.docs))).toEqual({ ok: true, value: step.docs });
      expect(parseLineList(formatLineList(step.drivers))).toEqual({
        ok: true,
        value: step.drivers,
      });
    }
  });
});

// --- the audit diff ---------------------------------------------------------

describe('§C.6 one history row per CHANGED field', () => {
  it('logs only what moved, with old and new on each row', () => {
    const rows = diffForHistory(
      'os_process_steps',
      'step-9',
      { name: 'Stock take', risk: 'lama', note: 'tetap' },
      { name: 'Stock take', risk: 'baru', note: 'tetap' },
    );
    expect(rows).toEqual([
      {
        tableName: 'os_process_steps',
        rowId: 'step-9',
        field: 'risk',
        oldValue: 'lama',
        newValue: 'baru',
      },
    ]);
  });

  it('a save that touched one word does not write nine rows claiming otherwise', () => {
    const before = { a: '1', b: '2', c: '3', d: '4', e: '5' };
    expect(diffForHistory('t', 'r', before, { ...before, c: 'x' })).toHaveLength(1);
    expect(diffForHistory('t', 'r', before, before)).toEqual([]);
  });

  it('treats "" and null as the same absence — retyping nothing is not a change', () => {
    expect(diffForHistory('t', 'r', { note: '' }, { note: null })).toEqual([]);
    expect(diffForHistory('t', 'r', { note: null }, { note: '' })).toEqual([]);
    expect(diffForHistory('t', 'r', { note: undefined }, { note: '' })).toEqual([]);
    // But filling an empty field IS a change, and logs null → value.
    expect(diffForHistory('t', 'r', { note: '' }, { note: 'ada' })).toEqual([
      { tableName: 't', rowId: 'r', field: 'note', oldValue: null, newValue: 'ada' },
    ]);
    // And clearing one logs value → null, so a deletion is recoverable.
    expect(diffForHistory('t', 'r', { note: 'ada' }, { note: null })).toEqual([
      { tableName: 't', rowId: 'r', field: 'note', oldValue: 'ada', newValue: null },
    ]);
  });

  it('serialises the list columns so a coa edit is legible in the log', () => {
    const rows = diffForHistory(
      'os_process_steps',
      'step-9',
      { coa: [{ code: '6.3.01', label: 'Storing' }] },
      { coa: [{ code: '6.3.01', label: 'Storing — Manpower' }] },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].oldValue).toBe('[{"code":"6.3.01","label":"Storing"}]');
    expect(rows[0].newValue).toBe('[{"code":"6.3.01","label":"Storing — Manpower"}]');
    // An empty list is a value, not an absence: emptying docs must be logged.
    expect(diffForHistory('t', 'r', { docs: ['a'] }, { docs: [] })[0].newValue).toBe('[]');
  });

  it('isDirty and the audit diff answer the same question', () => {
    const before = { name: 'a', note: '' };
    expect(isDirty(before, { name: 'a', note: '' })).toBe(false);
    expect(isDirty(before, { name: 'a', note: null })).toBe(false);
    expect(isDirty(before, { name: 'a', note: 'x' })).toBe(true);
  });
});

// --- the vocabularies -------------------------------------------------------

describe('§C.5 kind and status mirror their CHECK constraints', () => {
  it('matches the vocabulary the seed migration writes', () => {
    expect([...NEED_KINDS]).toEqual(['MASTER', 'TRANSAKSI', 'PARAMETER', 'REFERENSI']);
    expect([...NEED_STATUSES]).toEqual(['ADA', 'SEBAGIAN', 'BELUM']);
  });

  it('covers every value the live SAMB rows already use', () => {
    const sql = read('supabase/migrations/20260806000051_samb_process_seed.sql');
    for (const kind of sql.matchAll(/'(MASTER|TRANSAKSI|PARAMETER|REFERENSI)'/g)) {
      expect(NEED_KINDS as readonly string[]).toContain(kind[1]);
    }
    for (const status of sql.matchAll(/'(ADA|SEBAGIAN|BELUM)'/g)) {
      expect(NEED_STATUSES as readonly string[]).toContain(status[1]);
    }
  });
});

// --- structure is not editable, enforced by the types themselves ------------

describe('§C.2 the write types cannot NAME a structural column', () => {
  /**
   * Compile-time, not runtime: if any of these ever gains a forbidden key the
   * `true` below stops being assignable and `tsc` fails. A disabled input can
   * be re-enabled by the next edit to a panel; a type cannot.
   */
  type Rejects<T, Forbidden extends string> = Extract<keyof T, Forbidden> extends never
    ? true
    : false;

  it('rejects slot, laneKey, track, entityCode, label and id on steps', () => {
    const proof: Rejects<
      ProcessStepTextWrite,
      'slot' | 'laneKey' | 'lane_key' | 'track' | 'entityCode' | 'entity_code' | 'label' | 'id'
    > = true;
    expect(proof).toBe(true);
    // And the editable surface is exactly this, so an added field is a
    // deliberate act rather than an accident of spreading a row.
    const patch: ProcessStepTextWrite = {
      name: '',
      co: null,
      risk: null,
      control: null,
      note: null,
      gateId: null,
      docs: [],
      coa: [],
      drivers: [],
    };
    expect(Object.keys(patch).sort()).toEqual(
      ['co', 'coa', 'control', 'docs', 'drivers', 'gateId', 'name', 'note', 'risk'].sort(),
    );
  });

  it('rejects the owning ids on needs, gates, lanes and phases', () => {
    const need: Rejects<ProcessNeedTextWrite, 'id' | 'stepId' | 'step_id'> = true;
    const gate: Rejects<ProcessGateTextWrite, 'id' | 'type' | 'entityCode'> = true;
    // A lane's `label` IS its prose; its KEY and geometry are not editable.
    const lane: Rejects<ProcessLaneTextWrite, 'key' | 'ordinal' | 'isExternal' | 'entityCode'> =
      true;
    const phase: Rejects<
      ProcessPhaseTextWrite,
      'id' | 'entityCode' | 'slotFrom' | 'slotTo' | 'slot_from' | 'slot_to'
    > = true;
    expect([need, gate, lane, phase]).toEqual([true, true, true, true]);
  });
});

describe('§C.2 the Supabase update payloads carry text columns and nothing else', () => {
  const source = read('src/data/supabaseRepository.ts');

  /** The `.update({ … })` object literal of one repository method. */
  function payloadKeys(method: string): string[] {
    const start = source.indexOf(`async ${method}(`);
    expect(start).toBeGreaterThan(-1);
    const from = source.indexOf('.update({', start);
    expect(from).toBeGreaterThan(-1);
    const to = source.indexOf('})', from);
    return [...source.slice(from + '.update({'.length, to).matchAll(/(\w+)\s*:/g)].map(
      (match) => match[1],
    );
  }

  it('updateProcessStepText writes prose, the three lists and gate_id — never slot/lane_key/track', () => {
    expect(payloadKeys('updateProcessStepText').sort()).toEqual(
      ['coa', 'control', 'co', 'docs', 'drivers', 'gate_id', 'name', 'note', 'risk'].sort(),
    );
  });

  it('updateProcessNeedText never writes step_id', () => {
    expect(payloadKeys('updateProcessNeedText').sort()).toEqual(
      ['item', 'kind', 'owner', 'requested_on', 'src', 'status'].sort(),
    );
  });

  it('updateProcessGateText never writes id or type', () => {
    expect(payloadKeys('updateProcessGateText').sort()).toEqual(
      ['owner', 'sub', 'title', 'unblock'].sort(),
    );
  });

  it('updateProcessLaneText writes label and description only; the key stays in the filter', () => {
    expect(payloadKeys('updateProcessLaneText').sort()).toEqual(['description', 'label'].sort());
  });

  it('updateProcessPhaseText writes the name only — the ribbon geometry is not editable', () => {
    expect(payloadKeys('updateProcessPhaseText')).toEqual(['name']);
  });

  it('no process write reaches os_finish_line_* at all', () => {
    const writes = source.split('async updateProcess').slice(1);
    expect(writes).toHaveLength(5);
    for (const body of writes) {
      const method = body.slice(0, body.indexOf('.eq('));
      expect(method).not.toContain('os_finish_line');
    }
  });
});

// --- the audit table's shape, read off the migration -----------------------

describe('§C.6 migration 20260806000055 is append-only BY POLICY SET', () => {
  const sql = read('supabase/migrations/20260806000055_process_text_history.sql');

  it('creates select and insert policies, and deliberately no update or delete', () => {
    const policies = [...sql.matchAll(/create policy\s+"([^"]+)"[\s\S]*?for\s+(\w+)/g)].map(
      (match) => match[2],
    );
    expect(policies.sort()).toEqual(['insert', 'select']);
    expect(policies).not.toContain('update');
    expect(policies).not.toContain('delete');
    // With RLS on, the ABSENCE is the guarantee — so RLS must be on.
    expect(sql).toContain('enable row level security');
  });

  it('gates both policies behind the app key, wrapped for the planner', () => {
    expect([...sql.matchAll(/\(select public\.os_key_valid\(\)\)/g)]).toHaveLength(2);
  });

  it('re-runs cleanly: the table is if-not-exists and the policies are guarded', () => {
    expect(sql).toContain('create table if not exists public.os_process_text_history');
    expect(sql).toContain('create index if not exists');
    expect([...sql.matchAll(/if not exists \(select 1 from pg_policies/g)]).toHaveLength(2);
  });

  it('keys the log by text with NO foreign key — one log spans five tables', () => {
    const body = sql.slice(sql.indexOf('create table'), sql.indexOf('comment on table'));
    expect(body).toContain('row_id     text not null');
    expect(body.toLowerCase()).not.toContain('references');
    expect(body).toContain('old_value  text');
    expect(body).toContain('new_value  text');
  });

  it('ships with a down migration that removes it', () => {
    const down = read('supabase/migrations/down/20260806000055_process_text_history_down.sql');
    expect(down).toContain('drop table if exists public.os_process_text_history');
  });

  it('touches no other table — this migration adds a log, it does not alter the process', () => {
    // `--` comments and `comment on … is '…'` both name
    // os_finish_line_cell_history as the precedent; what matters is that no
    // executable statement reaches it, so strip the documentation first.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .replace(/comment on[\s\S]*?';/g, '');
    const touched = [
      ...statements.matchAll(/\b(?:alter|drop|truncate|create) table[^\n]*?(os_\w+)/g),
    ].map((match) => match[1]);
    expect([...new Set(touched)]).toEqual(['os_process_text_history']);
    expect(statements).not.toContain('os_finish_line');
    expect(statements).not.toMatch(/\binsert into\b/);
    expect(statements).not.toMatch(/\bupdate\s+public\./);
  });
});
