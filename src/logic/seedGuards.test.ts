/**
 * THE SEED FILES ARE ONE-SHOT NOW, AND THIS IS WHAT KEEPS THEM THAT WAY.
 *
 * Both process seeds guarded their phases and needs sections with
 * `where not exists` predicates that match on TEXT — a phase's `name`, a
 * need's `item`. Migration 20260806000055 made that text editable from the
 * app, which turned both guards into near-misses: edit one word, re-run the
 * seed, and the row inserts a SECOND time with no error and no notice. There
 * is no way to see it except by counting.
 *
 * The phases guard was fixable — a phase IS its slot span, and slot_from /
 * slot_to are not editable — so it now keys on geometry. The needs guard was
 * NOT: item, kind, src, owner and status are all editable and one step has
 * many needs, so no combination of them is a stable natural key, and adding a
 * seed-key column is schema cost for a hazard whose only trigger is a human
 * re-running an applied migration.
 *
 * So the files refuse instead. Section 0 of each raises before any statement,
 * and because a migration is one transaction the whole thing rolls back.
 *
 * These assertions are cheap and the thing they protect is not: the failure
 * mode they guard against produces no error, no log line, and no visible
 * symptom until someone counts rows months later.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

const SAMB = read('20260806000051_samb_process_seed.sql');
const ARBI = read('20260806000053_arbi_process_seed.sql');
const BRIDGE = read('20260806000056_samb_bridge_18b.sql');
const BRIDGE_DOWN = readFileSync(
  new URL('../../supabase/migrations/down/20260806000056_samb_bridge_18b_down.sql', import.meta.url),
  'utf8',
);

/** Statements only — the headers argue at length and would match everything. */
const statements = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

const seeds: Array<[string, string, string]> = [
  ['SAMB', SAMB, "'SAMB'"],
  ['ARBI', ARBI, "'ARBI'"],
];

describe('§2 both seeds refuse to run twice', () => {
  it.each(seeds)('%s raises before any insert', (_entity, sql) => {
    const body = statements(sql);
    const guard = body.indexOf('raise exception');
    const firstInsert = body.indexOf('insert into');
    expect(guard).toBeGreaterThan(-1);
    expect(firstInsert).toBeGreaterThan(-1);
    // The order is the whole mechanism: one transaction, raise first, roll back.
    expect(guard).toBeLessThan(firstInsert);
  });

  it.each(seeds)('%s tests for rows that already exist, not for anything else', (_e, sql) => {
    const guard = statements(sql).slice(0, statements(sql).indexOf('raise exception'));
    expect(guard).toMatch(/if exists \(select 1 from public\.os_process_steps/);
  });

  it.each(seeds)('%s says WHY, not just "already seeded"', (_entity, sql) => {
    const message = /raise exception\s*\n?\s*'([^']*(?:''[^']*)*)'/.exec(sql)?.[1] ?? '';
    expect(message).toContain('sekali pakai');
    // The two words that matter: duplication, and that it is silent.
    expect(message).toContain('menduplikasi');
    expect(message).toContain('tanpa error');
    // And it says how to legitimately reseed.
    expect(message).toContain('down-migration');
  });

  /**
   * The SAMB guard deliberately does NOT name entity_code, and that asymmetry
   * is load-bearing rather than an oversight: 20260806000052 is the migration
   * that ADDS the column, and SAMB's seed only ever runs before it. Naming the
   * column would raise 42703 on the one run that is supposed to work.
   */
  it('SAMB guards on any step at all; ARBI guards on its own entity', () => {
    const sambGuard = SAMB.slice(0, SAMB.indexOf('raise exception'));
    expect(/if exists \(select 1 from public\.os_process_steps\)/.test(sambGuard)).toBe(true);

    const arbiGuard = ARBI.slice(0, ARBI.indexOf('raise exception'));
    expect(/where entity_code = 'ARBI'/.test(arbiGuard)).toBe(true);
  });
});

/**
 * These read the PREDICATE, with comments stripped first. The comments around
 * these guards necessarily discuss `name` and `entity_code` to explain why
 * they are absent, so a raw substring check would be satisfied — or broken —
 * by prose rather than by SQL.
 */
function predicateOf(sql: string, table: string): string {
  const section = statements(sql).slice(statements(sql).indexOf(`insert into public.${table}`));
  const from = section.indexOf('where not exists');
  return section.slice(from, section.indexOf(');', from));
}

describe('§2 the phases guard no longer matches on editable text', () => {
  it.each(seeds)('%s keys the phases predicate on the slot span', (_entity, sql) => {
    const predicate = predicateOf(sql, 'os_process_phases');
    expect(predicate).toContain('p.slot_from = v.slot_from');
    expect(predicate).toContain('p.slot_to = v.slot_to');
    // `name` is what the app can edit. It must not decide identity here.
    expect(predicate).not.toContain('p.name');
  });

  it('ARBI scopes it to its entity; SAMB cannot, because the column is not there yet', () => {
    expect(predicateOf(ARBI, 'os_process_phases')).toContain("p.entity_code = 'ARBI'");
    expect(predicateOf(SAMB, 'os_process_phases')).not.toContain('entity_code');
  });
});

describe('§2 the needs guard is deliberately untouched', () => {
  it.each(seeds)('%s still matches (step_id, item)', (_entity, sql) => {
    expect(predicateOf(sql, 'os_process_needs')).toContain(
      'n.step_id = s.id and n.item = v.item',
    );
  });

  it.each(seeds)('%s writes down why it cannot be fixed', (_entity, sql) => {
    // The comment IS the deliverable here — an unexplained text-keyed guard
    // reads as an oversight, and the next person "fixes" it by inventing a key.
    const section = sql.slice(sql.indexOf('insert into public.os_process_needs'));
    const comment = section.slice(0, section.indexOf('where not exists'));
    expect(comment).toContain('DELIBERATELY UNCHANGED');
    expect(comment).toContain('stable natural key');
    expect(comment).toContain('Section 0');
  });
});

describe('§3 migration 56 records the 18b bridge pair without re-applying it', () => {
  it('inserts exactly one pair, idempotently', () => {
    const body = statements(BRIDGE);
    expect([...body.matchAll(/insert into/g)]).toHaveLength(1);
    expect(body).toContain('on conflict (step_id, item_id) do nothing');
    expect(body).toContain("'2b7394bf-92f4-4900-b2a6-03353dbe6d98'::uuid");
  });

  it('resolves the step by (entity_code, label), never by a hardcoded step uuid', () => {
    const body = statements(BRIDGE);
    expect(body).toContain("s.entity_code = 'SAMB'");
    expect(body).toContain("s.label = '18b'");
    // Exactly one uuid in the whole statement: the Finish line item.
    expect([...body.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)])
      .toHaveLength(1);
  });

  it('warns in its header that it is already live, and names the ledger entry', () => {
    expect(BRIDGE).toContain('ALREADY APPLIED LIVE. DO NOT APPLY');
    expect(BRIDGE).toContain('samb_bridge_18b_to_sales_lp');
  });

  it('names the five SAMB steps that must stay unbridged', () => {
    for (const label of ['4, 11, 12', '22', '26']) expect(BRIDGE).toContain(label);
  });

  it('has a down that removes one pair and cannot reach 18a or ARBI', () => {
    const body = statements(BRIDGE_DOWN);
    expect(body).toContain('delete from public.os_process_step_items');
    expect(body).toContain("entity_code = 'SAMB' and label = '18b'");
    expect(body).toContain("'2b7394bf-92f4-4900-b2a6-03353dbe6d98'::uuid");
  });
});

describe('§4.5 this change adds no DDL anywhere', () => {
  const forbidden = /\b(create|alter|drop)\s+(table|policy|index|type|function)\b|\badd column\b/i;

  it.each([
    ['20260806000056_samb_bridge_18b.sql', BRIDGE],
    ['down/20260806000056_samb_bridge_18b_down.sql', BRIDGE_DOWN],
  ])('%s is data only', (_name, sql) => {
    expect(forbidden.test(statements(sql))).toBe(false);
  });

  it('the guards added to the seeds are control flow, not schema', () => {
    for (const sql of [SAMB, ARBI]) {
      const guard = statements(sql).slice(0, statements(sql).indexOf('insert into'));
      expect(forbidden.test(guard)).toBe(false);
      expect(guard).toContain('do $$');
    }
  });
});

describe('§4.6 no seed content moved', () => {
  /** VALUES rows per section, counted rather than eyeballed. */
  function sectionRows(sql: string): Record<string, number> {
    const out: Record<string, number> = {};
    const parts = sql.split(/^-- (\d+)\. (.+?)\s*-{2,}\s*$/m);
    for (let i = 1; i < parts.length; i += 3) {
      const rows = [...parts[i + 2].matchAll(/^\s*\(/gm)].length;
      if (rows > 0) out[`${parts[i]}. ${parts[i + 1].trim()}`] = rows;
    }
    return out;
  }

  it('SAMB still carries 6 lanes, 15 gates, 7 phases, 30 steps, 118 needs, 45 pairs', () => {
    expect(sectionRows(SAMB)).toEqual({
      '1. Lanes': 6,
      '2. Gates': 15,
      '3. Phases': 7,
      '4. Steps': 30,
      '5. Needs': 118,
      '6. The step → Finish line bridge': 45,
    });
  });

  it('ARBI still carries 3 tracks, 6 lanes, 12 gates, 7 phases, 23 steps, 112 needs, 37 pairs', () => {
    expect(sectionRows(ARBI)).toEqual({
      '1. Tracks': 3,
      '2. Lanes': 6,
      '3. Gates': 12,
      '4. Phases': 7,
      '5. Steps': 23,
      '6. Needs': 112,
      '7. The step → Finish line bridge': 37,
    });
  });
});
