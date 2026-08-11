/**
 * ===========================================================================
 * THE KGR CHAIN GETS CI. UNTIL THIS FILE, IT HAD NONE.
 * ===========================================================================
 * SAMB has its bridge pinned by processModel.test.ts and ARBI has its whole
 * seed pinned by arbiSeedParity.test.ts. KGR had neither: 38 steps, 42 gates
 * and 117 needs whose only verification was opening Supabase and looking. A
 * refactor of the process layer could not break KGR loudly, which is the
 * worst failure mode the seed's own header warns about — the canvas still
 * draws, the numbers just quietly stop being the pinned ones.
 *
 * WHAT THIS IS AND IS NOT. It reads the migration FILES, not the database, so
 * it runs in CI with no credentials. That means it cannot prove live matches
 * the files — nothing offline can. What it proves is that the files stay
 * internally coherent, and that the amendment in 73 stays on the editable
 * side of the line. Live parity was verified by hand at apply time and is
 * recorded in 73's header; this file is what keeps the NEXT edit honest.
 *
 * THE LOAD-BEARING TEST IS THE LAST BLOCK. `73 changes text and nothing else`
 * mechanically enforces src/logic/processTextEdit.ts's rule — TEXT IS
 * EDITABLE, STRUCTURE IS NOT — against a migration for the first time. The
 * write types make the rule unbreakable from the app; nothing made it
 * unbreakable from a .sql file until here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEED = readFileSync(
  new URL('../../supabase/migrations/20260807000061_kgr_process_seed_v2.sql', import.meta.url),
  'utf8',
);
const TEXT_DECISIONS = readFileSync(
  new URL('../../supabase/migrations/20260810000073_kgr_text_decisions.sql', import.meta.url),
  'utf8',
);
const DECISION_NEEDS = readFileSync(
  new URL('../../supabase/migrations/20260810000074_kgr_decision_needs.sql', import.meta.url),
  'utf8',
);
const FINAL_TEXT_20_21 = readFileSync(
  new URL('../../supabase/migrations/20260810000075_kgr_step_20_21_final_text.sql', import.meta.url),
  'utf8',
);

/** The seed is sectioned by `-- N. Title` comments; slice between two of them. */
function section(from: string, to: string): string {
  const start = SEED.indexOf(from);
  const end = SEED.indexOf(to);
  expect(start, `section marker missing: ${from}`).toBeGreaterThan(-1);
  expect(end, `section marker missing: ${to}`).toBeGreaterThan(start);
  return SEED.slice(start, end);
}

const TRACKS_SECTION = section('-- 2. Tracks', '-- 3. Lanes');
const LANES_SECTION = section('-- 3. Lanes', '-- 4. Gates');
const GATES_SECTION = section('-- 4. Gates', '-- 5. Phases');
const PHASES_SECTION = section('-- 5. Phases', '-- 6. Steps');
const STEPS_SECTION = section('-- 6. Steps', '-- 7. Needs');
const NEEDS_SECTION = section('-- 7. Needs', '-- 8. NO bridge');

/** One tuple opener per step: label, slot, lane, co, track, name. */
const stepTuples = [
  ...STEPS_SECTION.matchAll(
    /^ {2}\('KGR', '(\d+)', (\d+), '([A-Z]+)', '([^']*)', '([A-Z]+)', '([^']*)',$/gm,
  ),
].map((match) => ({
  label: match[1],
  slot: Number(match[2]),
  laneKey: match[3],
  track: match[5],
  name: match[6],
}));

/** The gate reference sits on its own continuation line, right before docs. */
const stepGateRefs = [...STEPS_SECTION.matchAll(/^ {3}('TBC-[\w-]+'|null), '\[/gm)].map((match) =>
  match[1] === 'null' ? null : match[1].slice(1, -1),
);

const gateIds = [...GATES_SECTION.matchAll(/^ {2}\('(TBC-[\w-]+)', '(DECISION|DATA)',/gm)].map(
  (match) => match[1],
);

const laneKeys = [
  ...LANES_SECTION.matchAll(/^ {2}\('KGR', '([A-Z]+)', '([A-Z]+)', '[^']*', (\d+), (true|false)\)/gm),
].map((match) => ({ key: match[1], ordinal: Number(match[3]), isExternal: match[4] === 'true' }));

const trackCodes = [
  ...TRACKS_SECTION.matchAll(/^ {2}\('KGR', '([A-Z]+)', '([A-Z]+)', (\d), (true|false)\)/gm),
].map((match) => ({ code: match[1], ordinal: Number(match[3]), isShared: match[4] === 'true' }));

const phases = [...PHASES_SECTION.matchAll(/^ {2}\('([^']+)', (\d+), (\d+)\),?$/gm)].map(
  (match) => ({ name: match[1], from: Number(match[2]), to: Number(match[3]) }),
);

const needStatuses = [...NEEDS_SECTION.matchAll(/, '(ADA|SEBAGIAN|BELUM)'\),?$/gm)].map(
  (match) => match[1],
);

describe('migration 61 seeds the shape its own header claims', () => {
  it('carries 38 steps, 42 gates, 9 lanes, 10 phases and 3 tracks', () => {
    expect(stepTuples).toHaveLength(38);
    expect(gateIds).toHaveLength(42);
    expect(laneKeys).toHaveLength(9);
    expect(phases).toHaveLength(10);
    expect(trackCodes).toHaveLength(3);
  });

  it('carries 117 needs split ADA 9 · SEBAGIAN 34 · BELUM 74', () => {
    expect(needStatuses).toHaveLength(117);
    const tally = (status: string) => needStatuses.filter((value) => value === status).length;
    expect({ ADA: tally('ADA'), SEBAGIAN: tally('SEBAGIAN'), BELUM: tally('BELUM') }).toEqual({
      ADA: 9,
      SEBAGIAN: 34,
      BELUM: 74,
    });
  });

  it('numbers slots 1..38 exactly once, with label matching slot', () => {
    expect(stepTuples.map((step) => step.slot).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 38 }, (_, index) => index + 1),
    );
    for (const step of stepTuples) {
      expect(Number(step.label), `step ${step.label} label must equal its slot`).toBe(step.slot);
    }
  });

  it('tiles slots 1..38 with phases that never overlap and never gap', () => {
    const ordered = [...phases].sort((a, b) => a.from - b.from);
    expect(ordered[0].from).toBe(1);
    expect(ordered[ordered.length - 1].to).toBe(38);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index].from, `phase ${ordered[index].name} must resume the ribbon`).toBe(
        ordered[index - 1].to + 1,
      );
    }
  });

  it('references only gates it declares, and declares the split-off decision gates', () => {
    expect(stepGateRefs).toHaveLength(38);
    for (const ref of stepGateRefs) {
      if (ref === null) continue;
      expect(gateIds, `step references undeclared gate ${ref}`).toContain(ref);
    }
    // The three gates the cost architecture cannot be read without.
    for (const required of ['TBC-07', 'TBC-15', 'TBC-16']) {
      expect(gateIds).toContain(required);
    }
  });

  it('draws every step in a declared lane and a declared track', () => {
    const declaredLanes = new Set(laneKeys.map((lane) => lane.key));
    const declaredTracks = new Set(trackCodes.map((track) => track.code));
    for (const step of stepTuples) {
      expect(declaredLanes, `step ${step.label} sits in undeclared lane`).toContain(step.laneKey);
      expect(declaredTracks, `step ${step.label} carries undeclared track`).toContain(step.track);
    }
  });

  it('keeps the track distribution trackFilterRule.test.ts pins: 1 KARKAS · 3 OLAHAN · 34 shared', () => {
    const tally = (track: string) => stepTuples.filter((step) => step.track === track).length;
    expect({
      KARKAS: tally('KARKAS'),
      OLAHAN: tally('OLAHAN'),
      KEDUANYA: tally('KEDUANYA'),
    }).toEqual({ KARKAS: 1, OLAHAN: 3, KEDUANYA: 34 });
  });

  it('never writes a Finish line table, and authors no bridge for KGR', () => {
    for (const banned of [
      'os_finish_line_cells',
      'os_finish_line_cell_history',
      'os_finish_line_accounts',
    ]) {
      expect(SEED).not.toContain(banned);
    }
    expect(SEED).not.toMatch(/insert into public\.os_finish_line_items/);
    expect(SEED).not.toMatch(/insert into public\.os_process_step_items/);
  });
});

describe('the split-off architecture stays where the decisions put it', () => {
  const stepAt = (slot: number) => {
    const step = stepTuples.find((candidate) => candidate.slot === slot);
    expect(step, `no step at slot ${slot}`).toBeDefined();
    return step!;
  };

  it('keeps the split-off point at the carcass, on step 12', () => {
    expect(stepAt(12).name).toContain('TITIK SPLIT-OFF');
  });

  it('keeps joint allocation before separable cost — 20 then 21, never reversed', () => {
    expect(stepAt(20).name).toContain('NRV-based joint costing');
    expect(stepAt(21).name).toContain('separable cost');
    expect(stepAt(20).slot).toBeLessThan(stepAt(21).slot);
  });

  it('keeps Pool B applied at the freezing event, downstream of the disposition call', () => {
    expect(stepAt(30).name).toContain('disposisi');
    expect(stepAt(31).name).toContain('Pool B');
    expect(stepAt(30).slot).toBeLessThan(stepAt(31).slot);
  });

  it('keeps LCNRV downstream of every step that can add cost to a frozen SKU', () => {
    const lcnrv = stepAt(37);
    expect(lcnrv.name).toContain('LCNRV');
    for (const upstream of [20, 21, 31]) {
      expect(stepAt(upstream).slot).toBeLessThan(lcnrv.slot);
    }
  });
});

describe('migration 73 records the D1-D5 decisions', () => {
  it('keeps NRV as the method and names the interim convention, with its retirement', () => {
    expect(TEXT_DECISIONS).toContain('KONVENSI INTERIM');
    expect(TEXT_DECISIONS).toContain('DI SINI KONVENSI INTERIM STEP 20 DICABUT');
    // The separable deduction must NOT be zeroed — that is the whole
    // difference between the decision taken and the SVAS proposal refused.
    expect(TEXT_DECISIONS).toContain('deduksi separable cost TETAP dipakai');
  });

  it('refuses KRK and HJA at step 14 and drops the letter range from its name', () => {
    expect(TEXT_DECISIONS).toContain('KRK dan HJA TIDAK masuk sini');
    expect(TEXT_DECISIONS).toContain("name = 'Pemrosesan lanjut karkas → SKU hasil cut-up'");
    // The seed FILE is never edited retroactively — the house rule. The old
    // name must still be in 61, and only 73 may change it.
    expect(SEED).toContain('SKU A sampai J');
  });

  it('gives step 27 a COA and keeps freight out of inventory cost', () => {
    expect(TEXT_DECISIONS).toContain('Beban Angkut Keluar');
    expect(TEXT_DECISIONS).toContain('tidak pernah masuk nilai persediaan');
    expect(STEPS_SECTION).toContain("'TBC-25', '[\"Bukti Serah Terima (BST)\"");
  });

  it('scopes cold storage holding out of Pool B and into the period', () => {
    expect(TEXT_DECISIONS).toContain('Biaya Simpan Cold Storage');
    expect(TEXT_DECISIONS).toContain('RUANG LINGKUP POOL B BERHENTI DI PERISTIWA PEMBEKUAN');
  });
});

/** The editable surface, mirrored from src/logic/processTextEdit.ts. */
const EDITABLE: Record<string, string[]> = {
  os_process_steps: ['name', 'co', 'risk', 'control', 'note', 'gate_id', 'docs', 'coa', 'drivers'],
  os_process_needs: ['item', 'kind', 'src', 'owner', 'status', 'requested_on'],
  os_process_gates: ['title', 'sub', 'owner', 'unblock'],
  os_process_lanes: ['label', 'description'],
  os_process_phases: ['name'],
};

/**
 * Runs over EVERY text-only migration, not just the one that introduced the
 * rule. A future amendment that adds a file and forgets to add it here is the
 * only way past this, so the list is short on purpose and lives next to the
 * readFileSync calls that feed it.
 */
describe.each([
  ['73', TEXT_DECISIONS],
  ['75', FINAL_TEXT_20_21],
])('migration %s changes text and nothing else', (label, source) => {
  const updates = [
    ...source.matchAll(/update public\.(\w+) set\n([\s\S]*?)\nwhere ([\s\S]*?);\n/g),
  ].map((match) => ({ table: match[1], setBody: match[2], whereBody: match[3] }));

  it('parses as a file made only of UPDATEs — no row is added or removed', () => {
    // Self-verifying: the column checks below are only meaningful if the
    // regex caught EVERY statement. A missed one would pass vacuously, so
    // pin the parsed count against a plain textual count of the keyword.
    const declared = (source.match(/update public\./g) ?? []).length;
    expect(updates).toHaveLength(declared);
    expect(updates.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/insert into/i);
    expect(source).not.toMatch(/delete from/i);
    expect(source).not.toMatch(/alter table/i);
    expect(source).not.toMatch(/drop /i);
  });

  it('assigns only columns the app itself is allowed to write', () => {
    for (const update of updates) {
      const allowed = EDITABLE[update.table];
      expect(allowed, `migration ${label} writes unknown table ${update.table}`).toBeDefined();
      const assigned = [...update.setBody.matchAll(/^\s*(\w+)\s*=/gm)].map((match) => match[1]);
      expect(assigned.length, `no assignment parsed for ${update.table}`).toBeGreaterThan(0);
      for (const column of assigned) {
        expect(allowed, `${update.table}.${column} is structure, not text`).toContain(column);
      }
    }
  });

  it('never names a topology column, in any clause', () => {
    for (const update of updates) {
      for (const structural of ['slot', 'lane_key', 'track']) {
        expect(
          update.setBody,
          `${update.table} SET names the structural column ${structural}`,
        ).not.toMatch(new RegExp(`^\\s*${structural}\\s*=`, 'm'));
      }
    }
  });

  it('scopes every statement to KGR, so SAMB and ARBI cannot be reached', () => {
    for (const update of updates) {
      expect(update.whereBody, `unscoped update on ${update.table}`).toContain('KGR');
    }
  });
});

describe('migration 75 finishes steps 20 and 21 across their whole surface', () => {
  it('rewrites risk and control, which 73 left as seed prose', () => {
    // The gap this file exists to close: 73 gave step 20 a note that knew
    // about the interim convention and a control that did not.
    for (const field of ['risk =', 'control =', 'note =', 'docs =', 'drivers =']) {
      expect(FINAL_TEXT_20_21).toContain(field);
    }
  });

  it('turns the price back-test from a need into a control with teeth', () => {
    expect(FINAL_TEXT_20_21).toContain('wajib memicu revisi daftar harga, bukan penjelasan');
    // And the interim convention gets an expiry rather than an open end.
    expect(FINAL_TEXT_20_21).toContain('gugur otomatis');
  });

  it('names the estimate-vs-actual gap the interim convention created', () => {
    // Separable cost is a deduction inside NRV at 20 and an addition at 21.
    // Nothing reconciled the two; step 21 now says so.
    expect(FINAL_TEXT_20_21).toContain('SEPARABLE COST DIPAKAI DUA KALI DENGAN DUA PERAN');
    expect(FINAL_TEXT_20_21).toContain('bukan koreksi mundur atas batch yang sudah closed');
  });

  it('gives step 21 the gate it never had, and only a gate the seed declares', () => {
    expect(FINAL_TEXT_20_21).toMatch(/gate_id = 'TBC-41'/);
    expect(gateIds, 'step 21 must point at a declared gate').toContain('TBC-41');
  });

  it('leaves the two names and both COA lists alone', () => {
    // Deliberate: "7 langkah" is the SOP's own name, and inventing a variance
    // account for a reconciliation that posts no journal would be worse than
    // the gap it papers over.
    expect(FINAL_TEXT_20_21).not.toMatch(/^\s*name =/m);
    expect(FINAL_TEXT_20_21).not.toMatch(/^\s*coa =/m);
  });
});

describe('migration 74 adds needs and touches nothing else', () => {
  const rows = [
    ...DECISION_NEEDS.matchAll(
      /^ {2}\('(\d+)', '(.+?)', '(MASTER|TRANSAKSI|PARAMETER|REFERENSI)', '(.*?)', '(.*?)', '(ADA|SEBAGIAN|BELUM)'\),?$/gm,
    ),
  ].map((match) => ({ stepLabel: match[1], item: match[2], kind: match[3], status: match[6] }));

  it('adds exactly the five needs the decisions asked for, all still BELUM', () => {
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.status, `${row.item} should land as an open need`).toBe('BELUM');
    }
  });

  it('hangs them on the three steps that had no home for them', () => {
    const byStep = rows.reduce<Record<string, number>>((tally, row) => {
      tally[row.stepLabel] = (tally[row.stepLabel] ?? 0) + 1;
      return tally;
    }, {});
    // 20: the price back-test + its threshold. 27: freight + delivery term.
    // 30: the cold storage estimate that stays out of inventory cost.
    expect(byStep).toEqual({ '20': 2, '27': 2, '30': 1 });
  });

  it('closes the review’s residual risk — the price vector gets a feedback loop', () => {
    const backTest = rows.find((row) => row.item.startsWith('Back-test harga referensi'));
    expect(backTest, 'the back-test need is the whole reason this migration exists').toBeDefined();
    // A measurement with no threshold is a report. Step 22 pairs them; so does this.
    expect(rows.some((row) => row.item.includes('Ambang penyimpangan harga referensi'))).toBe(true);
  });

  it('is additive only — it never updates or deletes an existing row', () => {
    expect(DECISION_NEEDS).not.toMatch(/^update /im);
    expect(DECISION_NEEDS).not.toMatch(/delete from/i);
    expect(DECISION_NEEDS).not.toMatch(/alter table/i);
    // Every insert target is os_process_needs and nothing else.
    const targets = [...DECISION_NEEDS.matchAll(/insert into public\.(\w+)/g)].map(
      (match) => match[1],
    );
    expect(targets).toEqual(['os_process_needs']);
  });

  it('guards on the v0.2 shape before writing, like every KGR migration before it', () => {
    expect(DECISION_NEEDS).toMatch(/step_count <> 38/);
    expect(DECISION_NEEDS).toContain('raise exception');
    // Idempotent on (step_id, item), so a replay inserts nothing.
    expect(DECISION_NEEDS).toContain('where not exists');
  });
});
