/**
 * The tripwire between the app-side ARBI fixtures and the SQL that seeds
 * production — the same contract processModel.test.ts holds for SAMB's
 * bridge, extended to the whole ARBI seed: an edit to the JSON that misses
 * the migration (or vice versa) fails here instead of drifting silently.
 *
 * Also pins the THREE copies of SAMB's track vocabulary against each other:
 * migration 52's seed, fixtureTracks(), and LEGACY_SAMB_TRACKS (§4.6's
 * pre-apply fallback). If any pair disagrees, the pre-apply window or the
 * tests would walk different chains than production.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGACY_SAMB_TRACKS } from './processModel';
import { arbiBridgePairs, arbiGates, arbiNeeds, arbiSteps, arbiTracks } from './process/arbiFixture';
import { fixtureTracks } from './process/seedFixture';

const MIGRATION_53 = readFileSync(
  new URL('../../supabase/migrations/20260806000053_arbi_process_seed.sql', import.meta.url),
  'utf8',
);
const MIGRATION_52 = readFileSync(
  new URL('../../supabase/migrations/20260806000052_process_entity_aware.sql', import.meta.url),
  'utf8',
);

describe('migration 53 carries exactly the seed JSON', () => {
  it('bridges the same 37 (label, uuid) pairs, in the same many-to-many shape', () => {
    const section = MIGRATION_53.slice(MIGRATION_53.indexOf('os_process_step_items'));
    const pairs = [...section.matchAll(/\('([^']+)', '([0-9a-f-]{36})'\)/g)].map((match) => ({
      stepLabel: match[1],
      itemId: match[2],
    }));
    const fromJson = arbiBridgePairs();
    expect(pairs).toHaveLength(37);
    const key = (pair: { stepLabel: string; itemId: string }) =>
      `${pair.stepLabel}>${pair.itemId}`;
    expect(pairs.map(key).sort()).toEqual(fromJson.map(key).sort());
  });

  it('inserts one steps tuple per JSON step, every one tagged ARBI', () => {
    const tuples = [...MIGRATION_53.matchAll(/\('ARBI', '(\d+)', \d+, '/g)].map(
      (match) => match[1],
    );
    expect(tuples.sort((a, b) => Number(a) - Number(b))).toEqual(
      arbiSteps()
        .map((step) => step.label)
        .sort((a, b) => Number(a) - Number(b)),
    );
  });

  it('carries every need item and every gate id', () => {
    for (const gate of arbiGates()) {
      expect(MIGRATION_53).toContain(`('${gate.id}', '${gate.type}',`);
    }
    // Spot the two most breakable text classes end to end: the longest item
    // and one containing quotes/arrows, both must appear SQL-escaped.
    const items = arbiNeeds().map((need) => need.item);
    const longest = items.reduce((a, b) => (b.length > a.length ? b : a));
    expect(MIGRATION_53).toContain(longest.replace(/'/g, "''"));
    const needsSection = MIGRATION_53.slice(
      MIGRATION_53.indexOf('-- 6. Needs'),
      MIGRATION_53.indexOf('-- 7. The step'),
    );
    const needCount = [...needsSection.matchAll(/^ {2}\('\d+', '/gm)].length;
    expect(needCount).toBe(112);
  });

  it('never writes a Finish line table', () => {
    for (const banned of [
      'os_finish_line_cells',
      'os_finish_line_cell_history',
      'os_finish_line_accounts',
    ]) {
      expect(MIGRATION_53).not.toContain(banned);
    }
    // items appears ONLY as the FK target inside comments/joins — never as an
    // insert/update/delete target.
    expect(MIGRATION_53).not.toMatch(/insert into public\.os_finish_line_items/);
    expect(MIGRATION_53).not.toMatch(/update public\.os_finish_line/);
    expect(MIGRATION_53).not.toMatch(/delete from public\.os_finish_line/);
  });
});

describe("SAMB's track vocabulary exists in three copies that cannot drift", () => {
  const stripEntity = (tracks: ReturnType<typeof fixtureTracks>) =>
    tracks.map(({ code, label, ordinal, isShared }) => ({ code, label, ordinal, isShared }));

  it('fixtureTracks() === LEGACY_SAMB_TRACKS', () => {
    expect(fixtureTracks()).toEqual(LEGACY_SAMB_TRACKS);
  });

  it('migration 52 seeds exactly those three rows for SAMB', () => {
    const rows = [
      ...MIGRATION_52.matchAll(
        /\('SAMB', '([A-Z]+)',\s+'([A-Z]+)',\s+(\d), (true|false)\)/g,
      ),
    ].map((match) => ({
      code: match[1],
      label: match[2],
      ordinal: Number(match[3]),
      isShared: match[4] === 'true',
    }));
    expect(rows).toEqual(stripEntity(fixtureTracks()));
  });

  it("migration 53 seeds ARBI's vocabulary as the fixture reads it", () => {
    const rows = [
      ...MIGRATION_53.matchAll(
        /\('ARBI', '([A-Z]+)', '([A-Z]+)', (\d), (true|false)\)/g,
      ),
    ].map((match) => ({
      code: match[1],
      label: match[2],
      ordinal: Number(match[3]),
      isShared: match[4] === 'true',
    }));
    expect(rows).toEqual(stripEntity(arbiTracks()));
  });
});
