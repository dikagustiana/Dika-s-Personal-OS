// @vitest-environment jsdom
/**
 * §3.5.6 and §3.5.8 from the screen's side.
 *
 * The load-bearing test here is the FIRST one, and it is written the way the
 * DoD asks for: the sign-in log's absence is FORCED (the read is scripted to
 * answer 42P01, exactly as production does before migration 20260809000070),
 * not assumed. What it pins is that an unapplied migration costs the section
 * and nothing else — the Kolaborator screen still renders, the other three
 * sources still list, and the console stays empty.
 *
 * The second is its mirror and matters just as much: a read that genuinely
 * FAILED must not render as "no activity". Those two conditions arrive at this
 * component as different values on purpose, and a screen that treats them
 * alike would report an unreadable trail as an innocent one.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows, readAbsence, readFailure } from '../../data/readResult';
import type { FinishLineEntity } from '../../data/types';
import { useAppStore } from '../../store/appStore';
import { CollaboratorCard } from './CollaboratorCard';

vi.mock('../../components/PassphraseGate', () => ({
  readStoredKey: () => 'owner-passphrase',
  lockApp: vi.fn(),
}));

const provisionCollaborator = vi.fn();
vi.mock('../../data/supabaseRepository', () => ({
  provisionCollaborator: (...args: unknown[]) => provisionCollaborator(...args),
}));

const ENTITIES: FinishLineEntity[] = [{ code: 'SAMB', label: 'Sambungan', order: 1 }];

const HER = 'u-her';
const HIM = 'u-him';

const ROWS = [
  {
    userId: HER,
    email: 'indah.mutiara89@gmail.com',
    entityCodes: ['SAMB'],
    projectIds: [],
    lastSignInAt: '2026-08-07T04:17:27.000Z',
    createdAt: '2026-08-07T04:10:38.000Z',
  },
  {
    userId: HIM,
    email: 'tteddy.suryadi@gmail.com',
    entityCodes: ['SAMB'],
    projectIds: [],
    lastSignInAt: null,
    createdAt: '2026-08-05T14:04:44.000Z',
  },
];

const CELL_ROW = {
  id: 'ch-1',
  cellId: 'cell-a',
  fromState: 'input',
  toState: 'figure',
  noteChanged: false,
  actorKind: 'contributor',
  actor: HER,
  changedAt: '2026-08-07T04:20:00.000Z',
};

const TEXT_ROW = {
  id: 'tx-1',
  tableName: 'os_process_lanes',
  rowId: 'lane-gone',
  field: 'label',
  actorKind: 'contributor',
  actor: HER,
  changedAt: '2026-08-07T03:00:00.000Z',
};

/**
 * A repository whose four audit reads are scripted per test. Everything the
 * label phase might reach for answers empty, so a test that wants a raw
 * reference gets one.
 */
function repositoryWith(overrides: Partial<Record<string, unknown>>): Repository {
  const empty = async () => okRows([]);
  return {
    listProjects: async () => [],
    // This suite is about the activity trail, not the link store; 42P01 is the
    // state the bundle ships into and keeps the card's other half quiet.
    listCollabLinks: async () => readAbsence('listCollabLinks', { code: '42P01' }),
    listSignInLog: async () => okRows([]),
    listCellHistory: async () => okRows([]),
    listTaskHistory: async () => okRows([]),
    listProcessTextHistory: async () => okRows([]),
    listFinishLineCells: empty,
    listFinishLineItems: empty,
    listProjectTasks: empty,
    listProcessSteps: empty,
    listProcessNeeds: empty,
    listProcessGates: empty,
    listProcessLanes: empty,
    listProcessPhases: empty,
    ...overrides,
  } as unknown as Repository;
}

function mountWith(repository: Repository) {
  useAppStore.setState({ repository });
  return render(<CollaboratorCard entities={ENTITIES} />);
}

/** Opens one person's trail and waits for the load to settle. */
async function openTrail(email: string) {
  await screen.findByText(email);
  const toggles = screen.getAllByRole('button', { name: /jejak aktivitas/i });
  fireEvent.click(toggles[0]);
  await waitFor(() => expect(screen.queryByText(/Memuat jejak…/i)).toBeNull());
}

let spies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  window.sessionStorage.clear();
  provisionCollaborator.mockReset();
  provisionCollaborator.mockImplementation(async (_key: string, body: { action: string }) =>
    body.action === 'list' ? { users: ROWS } : {},
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'debug').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const consoleWasSilent = () => spies.every((spy) => spy.mock.calls.length === 0);

describe('the sign-in log table does not exist yet (42P01)', () => {
  it('renders the screen normally, omits the log, and says nothing to the console', async () => {
    mountWith(
      repositoryWith({
        // FORCED, not assumed: this is what production answers today.
        listSignInLog: async () => readAbsence('listSignInLog', { code: '42P01' }),
        listCellHistory: async () => okRows([CELL_ROW]),
      }),
    );

    // The Kolaborator screen itself is unaffected — both rows, both controls.
    await screen.findByText(ROWS[0].email);
    expect(screen.getByText(ROWS[1].email)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Tautan baru/i })).toHaveLength(2);

    await openTrail(ROWS[0].email);

    // The artefact change is listed; the sign-in section simply is not there.
    expect(screen.getByText(/sel cell-a/i)).toBeTruthy();
    expect(screen.queryByText(/^Masuk$/)).toBeNull();
    // And nothing anywhere claims a table is missing.
    expect(screen.queryByText(/42P01/i)).toBeNull();
    expect(screen.queryByText(/tidak terbaca/i)).toBeNull();
    expect(consoleWasSilent()).toBe(true);
  });

  it('still shows the empty state when the person has done nothing either', async () => {
    mountWith(
      repositoryWith({
        listSignInLog: async () => readAbsence('listSignInLog', { code: '42P01' }),
      }),
    );
    await openTrail(ROWS[0].email);
    expect(screen.getByText(/Belum ada aktivitas tercatat/i)).toBeTruthy();
    expect(consoleWasSilent()).toBe(true);
  });
});

describe('a read that genuinely failed is not an empty trail', () => {
  it('says the list may be incomplete, and names the condition', async () => {
    mountWith(
      repositoryWith({
        listCellHistory: async () =>
          readFailure('listCellHistory', {
            code: '42501',
            message: 'permission denied for table os_finish_line_cell_history',
          }),
      }),
    );
    await openTrail(ROWS[0].email);
    const notice = await screen.findByText(/belum tentu lengkap/i);
    expect(notice.textContent ?? '').toContain('42501');
    expect(consoleWasSilent()).toBe(true);
  });
});

describe('an untranslatable row_id is shown, not hidden', () => {
  it('renders the raw table and id, and marks it as raw', async () => {
    mountWith(
      repositoryWith({
        listSignInLog: async () => readAbsence('listSignInLog', { code: '42P01' }),
        listProcessTextHistory: async () => okRows([TEXT_ROW]),
      }),
    );
    await openTrail(ROWS[0].email);
    expect(screen.getByText(/os_process_lanes · lane-gone/i)).toBeTruthy();
    expect(screen.getByText(/rujukan mentah/i)).toBeTruthy();
    // The row is present, so the trail is not claiming nothing happened.
    expect(screen.queryByText(/Belum ada aktivitas tercatat/i)).toBeNull();
  });
});

describe('the trail belongs to one person', () => {
  it('shows her sign-in on her row and nothing on his', async () => {
    const repository = repositoryWith({
      listSignInLog: async () =>
        okRows([{ userId: HER, signedInAt: '2026-08-07T04:17:27.000Z' }]),
    });
    mountWith(repository);
    await openTrail(ROWS[0].email);
    expect(screen.getByText(/^Masuk$/)).toBeTruthy();

    // Close hers, open his.
    fireEvent.click(screen.getAllByRole('button', { name: /tutup jejak/i })[0]);
    const toggles = screen.getAllByRole('button', { name: /jejak aktivitas/i });
    fireEvent.click(toggles[toggles.length - 1]);
    await waitFor(() => expect(screen.queryByText(/Memuat jejak…/i)).toBeNull());
    expect(screen.queryByText(/^Masuk$/)).toBeNull();
    expect(screen.getByText(/Belum ada aktivitas tercatat/i)).toBeTruthy();
  });
});

describe('pre-migration-69 text edits are counted, never assigned', () => {
  it('reports them as unattributable instead of putting them in a trail', async () => {
    mountWith(
      repositoryWith({
        listSignInLog: async () => readAbsence('listSignInLog', { code: '42P01' }),
        listProcessTextHistory: async () =>
          okRows([{ ...TEXT_ROW, actorKind: null, actor: null }]),
      }),
    );
    await openTrail(ROWS[0].email);
    expect(screen.getByText(/tercatat tanpa aktor/i)).toBeTruthy();
    expect(screen.queryByText(/os_process_lanes · lane-gone/i)).toBeNull();
  });
});
