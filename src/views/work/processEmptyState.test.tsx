// @vitest-environment jsdom
/**
 * §10 — WHAT AN EMPTY STATE IS ALLOWED TO CLAIM.
 *
 * Three investigations produced this rule, and the middle one is why these
 * tests exist rather than a comment:
 *
 *   1. Kebutuhan data read zero because a guard swallowed a non-42P01 error.
 *      It rendered as a legitimate empty list, with no message at all.
 *   2. A contributor's swimlane read zero because RLS declined, and the app
 *      announced that the seed had not landed — while the seed was intact at
 *      53 steps. Two people went looking for a data problem that was a
 *      permissions problem, because the screen told them which one it was.
 *   3. `permission denied for function os_member_entities` reached the screen
 *      verbatim, and was diagnosed in seconds. That one is the model.
 *
 * The rule: A SUCCESSFUL READ RETURNING ZERO ROWS IS AMBIGUOUS between an
 * empty table and RLS filtering every row, and the frontend cannot tell them
 * apart — the database returns an empty set for both, with no error either
 * way. So the copy states the observation and stops.
 *
 * What it MAY add is whose access produced the zero, because the app does
 * know that. It is an observation, not a diagnosis, and it is the most useful
 * thing on the screen when the answer looks wrong.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows, readAbsence, readFailure, type ReadResult } from '../../data/readResult';
import type {
  FinishLineItem,
  ProcessNeed,
  ProcessReference,
  ProcessStep,
} from '../../data/types';
import { arbiNeeds, arbiSteps, arbiTracks } from '../../logic/process/arbiFixture';
import { useAppStore, type Viewer } from '../../store/appStore';
import { FinishLineNeeds } from './FinishLineNeeds';
import { accessLabel, entityEmptyClause, processEmptyClause } from './processUi';

const noop = () => {};
const OWNER: Viewer = { kind: 'owner' };
const FIVE: Viewer = {
  kind: 'contributor',
  userId: 'u1',
  entityCodes: ['SAMB', 'ARBI', 'ASI', 'KNI', 'KDU'],
};
const ARBI_ONLY: Viewer = { kind: 'contributor', userId: 'u2', entityCodes: ['ARBI'] };

const TABLES = { absent: 'os_process_needs', unseeded: 'os_process_needs' };

afterEach(() => {
  cleanup();
  useAppStore.setState({ prosesEntity: 'SAMB', prosesFocus: null, viewer: OWNER });
});

// ---------------------------------------------------------------------------

describe('§10.2 a successful read of zero rows never names a cause', () => {
  it('states the observation, and no clause claims the seed is missing', () => {
    for (const viewer of [OWNER, FIVE, ARBI_ONLY]) {
      const clause = processEmptyClause('unseeded', viewer, TABLES);
      expect(clause).toContain('terbaca tanpa error');
      expect(clause).toContain('nol baris');
      // The three cause-claims this view has actually made, all forbidden.
      expect(clause).not.toContain('seed');
      expect(clause).not.toContain('belum masuk');
      expect(clause).not.toContain('migration');
    }
  });

  it('names whose access produced the zero, because the app knows it', () => {
    expect(processEmptyClause('unseeded', OWNER, TABLES)).toContain('akses pemilik');
    expect(processEmptyClause('unseeded', ARBI_ONLY, TABLES)).toContain(
      'akses kontributor (ARBI)',
    );
  });

  it('abbreviates a long membership rather than printing five codes', () => {
    // Five entities in a 44px row is a wrapped line; three plus a count is not.
    expect(accessLabel(FIVE)).toBe('akses kontributor (SAMB, ARBI, ASI +2)');
    expect(accessLabel(ARBI_ONLY)).toBe('akses kontributor (ARBI)');
    expect(accessLabel(OWNER)).toBe('akses pemilik');
  });

  it('lets `absent` keep its cause — the read PROVED that one', () => {
    const clause = processEmptyClause('absent', OWNER, TABLES);
    expect(clause).toContain('42P01');
    expect(clause).toContain('belum ada di database');
    // And it must not be mistakable for the zero-rows sentence.
    expect(clause).not.toContain('terbaca tanpa error');
  });
});

describe('§10.2 the per-entity zero says nothing about the database', () => {
  it('does not tell a contributor that an entity they cannot read is empty', () => {
    // SAMB has 30 steps. An ARBI-only contributor at ?entity=SAMB used to be
    // told "Entitas SAMB belum punya rantai proses", which is simply false.
    const clause = entityEmptyClause('SAMB', ARBI_ONLY);
    expect(clause).not.toContain('belum punya rantai proses');
    expect(clause).toContain('Nol step terbaca');
    expect(clause).toContain('di luar keanggotaan sesi ini');
  });

  it('offers the picker only to a reader who has somewhere else to go', () => {
    expect(entityEmptyClause('ASI', OWNER)).toContain('pilih entitas lain');
    expect(entityEmptyClause('SAMB', ARBI_ONLY)).not.toContain('pilih entitas lain');
  });
});

// ---------------------------------------------------------------------------

describe('§10.2 a real error surfaces verbatim, with its code and operation', () => {
  it('does not swallow 42501 into an empty state — the last regression', () => {
    const result = readAbsence('listProcessSteps', {
      code: '42501',
      message: 'permission denied for function os_member_entities',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
    expect(result.detail).toContain('listProcessSteps');
    expect(result.detail).toContain('42501');
    expect(result.detail).toContain('izin ditolak');
    expect(result.detail).toContain('permission denied for function os_member_entities');
  });

  it('keeps 42P01 and 42703 apart, each naming its own condition', () => {
    const absent = readAbsence('listProcessSteps', {
      code: '42P01',
      message: 'relation "os_process_steps" does not exist',
    });
    const column = readAbsence('listProcessSteps', {
      code: '42703',
      message: 'column os_process_steps.entity_code does not exist',
    });
    expect(absent.ok).toBe(false);
    expect(column.ok).toBe(false);
    if (absent.ok || column.ok) return;
    // Different reasons, and different sentences — never one shared clause.
    expect(absent.reason).toBe('missing-relation');
    expect(column.reason).toBe('failed');
    expect(absent.detail).toContain('tabel belum ada');
    expect(column.detail).toContain('kolom belum ada');
    expect(column.detail).toContain('bukan data kosong');
  });

  it('keeps the code even when the driver supplies prose — it used to drop it', () => {
    const result = readFailure('listFinishLineItems', {
      code: '42501',
      message: 'permission denied for table os_finish_line_items',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('42501');
  });
});

// ---------------------------------------------------------------------------

function needsRepository(overrides: Partial<Repository>): Repository {
  return {
    listProcessSteps: async () => okRows<ProcessStep>([]),
    listProcessNeeds: async () => okRows<ProcessNeed>([]),
    listProcessTracks: async () => okRows(arbiTracks()),
    listProcessForms: async () => okRows([]),
    listProcessReferences: async () => okRows<ProcessReference>([]),
    listFinishLineItems: async () => okRows<FinishLineItem>([]),
    ...overrides,
  } as unknown as Repository;
}

describe('§10.2 the register renders the rule, not just exports it', () => {
  it('an ARBI-only contributor reading zero SAMB rows is told about access', async () => {
    useAppStore.setState({
      repository: needsRepository({
        listProcessSteps: async () => okRows(arbiSteps()),
        listProcessNeeds: async () => okRows(arbiNeeds()),
      }),
      prosesEntity: 'SAMB',
      viewer: ARBI_ONLY,
      prosesFocus: null,
    });
    render(<FinishLineNeeds onOpenStep={noop} />);
    await waitFor(() => {
      expect(screen.getByText(/Nol step terbaca untuk entitas SAMB/)).toBeDefined();
    });
    expect(screen.getByText(/di luar keanggotaan sesi ini/)).toBeDefined();
  });

  it('a permission failure reaches the screen instead of an empty table', async () => {
    useAppStore.setState({
      repository: needsRepository({
        listProcessNeeds: async () =>
          readAbsence('listProcessNeeds', {
            code: '42501',
            message: 'permission denied for function os_member_entities',
          }) as ReadResult<ProcessNeed>,
      }),
      viewer: OWNER,
      prosesFocus: null,
    });
    render(<FinishLineNeeds onOpenStep={noop} />);
    await waitFor(() => {
      expect(screen.getByText(/42501/)).toBeDefined();
    });
    expect(screen.getByText(/permission denied for function os_member_entities/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe('§12.6 the claim is gone from the codebase, not just from one file', () => {
  it('no source file tells a reader the seed has not landed', () => {
    // The needle is ASSEMBLED rather than written out, and that is deliberate
    // rather than clever: if this file spelled it, a reviewer running the
    // plain `grep` the DoD asks for would get a hit here and have to reason
    // about whether it counts. Built from parts, the phrase exists nowhere in
    // the tree, so the grep answer is an unambiguous zero — including in the
    // comments above, which paraphrase the old copy rather than quote it.
    const banned = ['seed-nya', 'belum', 'masuk'].join(' ');
    // vitest runs from the repo root, and cwd survives the jsdom environment
    // where import.meta.url does not resolve to a real filesystem path.
    const root = join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (readFileSync(path, 'utf8').includes(banned)) offenders.push(path);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
