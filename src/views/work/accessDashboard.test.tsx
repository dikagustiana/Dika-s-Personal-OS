// @vitest-environment jsdom
/**
 * The access matrix, from the owner's side: does a click become the right
 * audited call, does the cell move before the server answers, does it move
 * BACK when the server refuses, and does a person whose grants could not be
 * read render as "not known" rather than as a row of dashes.
 *
 * The provisioning function is a mock at the module boundary, the same seam
 * collaboratorLink.test.tsx uses; the repository reads are a stub on the
 * store. Nothing here touches a network.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows, readAbsence } from '../../data/readResult';
import type { FinishLineEntity, FinishLineItem, ScopeGrant } from '../../data/types';
import { useAppStore } from '../../store/appStore';
import { AccessMatrix } from './AccessDashboard';

vi.mock('../../components/PassphraseGate', () => ({
  readStoredKey: () => 'owner-passphrase',
  lockApp: vi.fn(),
}));

const provisionCollaborator = vi.fn();
vi.mock('../../data/supabaseRepository', () => ({
  isSupabaseConfigured: true,
  provisionCollaborator: (...args: unknown[]) => provisionCollaborator(...args),
}));

const S1 = 'f1a70000-0000-4000-8000-000000000a01';
const S2 = 'f1a70000-0000-4000-8000-000000000a02';

const ENTITIES: FinishLineEntity[] = [
  { code: 'SAMB', label: 'Sambungan', order: 1 },
  { code: 'ARBI', label: 'Arbitrase', order: 2 },
];

const ITEMS: FinishLineItem[] = [
  { id: S1, item: 'Neraca', kind: 'section', order: 1 },
  { id: S2, item: 'Laba rugi', kind: 'section', order: 2 },
  { id: 'm1', item: 'Kas', kind: 'metric', parentId: S1, order: 3 },
];

const HER = 'u-her';
const HIM = 'u-him';
const HER_EMAIL = 'indah.mutiara89@gmail.com';
const HIM_EMAIL = 'tteddy.suryadi@gmail.com';

const HER_GRANTS: ScopeGrant[] = [
  { entityCode: 'SAMB', sectionId: S1, capability: 'write' },
  { entityCode: 'SAMB', sectionId: S2, capability: 'read' },
];

interface Row {
  userId: string;
  email: string;
  entityCodes: string[];
  projectIds: string[];
  grants?: ScopeGrant[];
  link?: { status: string; mintedAt: string | null; expiresAt: string | null; usedAt: string | null };
  lastSignInAt: string | null;
  createdAt: string | null;
}

const HER_ROW: Row = {
  userId: HER,
  email: HER_EMAIL,
  entityCodes: ['SAMB'],
  projectIds: [],
  grants: HER_GRANTS,
  link: { status: 'live', mintedAt: '2026-09-04T01:00:00.000Z', expiresAt: null, usedAt: null },
  lastSignInAt: null,
  createdAt: '2026-08-07T04:10:38.000Z',
};

/** A function build that predates the scope axis: no `grants` at all. */
const HIM_ROW: Row = {
  userId: HIM,
  email: HIM_EMAIL,
  entityCodes: ['SAMB'],
  projectIds: [],
  lastSignInAt: null,
  createdAt: '2026-08-05T14:04:44.000Z',
};

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function respondWith(rows: Row[], onWrite?: (body: Record<string, unknown>) => unknown) {
  provisionCollaborator.mockImplementation(async (_key: string, body: Record<string, unknown>) => {
    if (body.action === 'list') return { users: rows };
    return onWrite ? onWrite(body) : {};
  });
}

const cellButton = (email: string, entity: string, section: string) =>
  screen.getByRole('button', {
    name: (name) => name.startsWith(`${email} · ${entity} · ${section}:`),
  }) as HTMLButtonElement;

beforeEach(() => {
  provisionCollaborator.mockReset();
  useAppStore.setState({
    repository: {
      listFinishLineEntities: async () => okRows(ENTITIES),
      listFinishLineItems: async () => okRows(ITEMS),
      // HER signed in once according to the app's own log; HIM never.
      listSignInLog: async () => okRows([{ userId: HER, signedInAt: '2026-08-07T04:17:27.000Z' }]),
      listCollabLinks: async () => readAbsence('listCollabLinks', { code: '42P01' }),
    } as unknown as Repository,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the matrix renders what the grants say', () => {
  it('draws W / R / — per (entity, section) and one column group per entity', async () => {
    respondWith([HER_ROW]);
    render(<AccessMatrix />);
    await screen.findByText(HER_EMAIL);
    expect(cellButton(HER_EMAIL, 'SAMB', 'Neraca').textContent).toBe('W');
    expect(cellButton(HER_EMAIL, 'SAMB', 'Laba rugi').textContent).toBe('R');
    expect(cellButton(HER_EMAIL, 'ARBI', 'Neraca').textContent).toBe('—');
    expect(cellButton(HER_EMAIL, 'ARBI', 'Laba rugi').textContent).toBe('—');
    // The section names head the columns, once per entity.
    expect(screen.getAllByRole('columnheader', { name: 'Neraca' })).toHaveLength(2);
  });

  it('badges the person from the sign-in log, and says never when there is nothing', async () => {
    respondWith([HER_ROW, HIM_ROW]);
    render(<AccessMatrix />);
    await screen.findByText(HIM_EMAIL);
    expect(screen.getByText(/masuk 2026-08-07 04:17/)).toBeTruthy();
    expect(screen.getByText('belum pernah masuk')).toBeTruthy();
  });

  it('renders "not known" across a row whose grants the function did not send — never dashes', async () => {
    respondWith([HER_ROW, HIM_ROW]);
    render(<AccessMatrix />);
    await screen.findByText(HIM_EMAIL);
    expect(screen.getByText(/Tidak bisa dicek/)).toBeTruthy();
    // No clickable cell exists for that row.
    expect(
      screen.queryByRole('button', { name: (name) => name.startsWith(`${HIM_EMAIL} · SAMB`) }),
    ).toBeNull();
  });

  it('shows the server link status when the function sent one', async () => {
    respondWith([HER_ROW]);
    render(<AccessMatrix />);
    await screen.findByText(HER_EMAIL);
    expect(screen.getByText('tautan aktif, masa berlaku tidak diketahui')).toBeTruthy();
  });

  it('falls back to "belum ada tautan" when there is no server status and no stored link', async () => {
    respondWith([HIM_ROW]);
    render(<AccessMatrix />);
    await screen.findByText(HIM_EMAIL);
    expect(screen.getByText('belum ada tautan')).toBeTruthy();
  });
});

describe('a click is one audited call, applied before the answer', () => {
  it('— → R sends grant-scope read for that one section and shows R at once', async () => {
    const pending = deferred<Record<string, unknown>>();
    respondWith([HER_ROW], () => pending.promise);
    render(<AccessMatrix />);
    await screen.findByText(HER_EMAIL);

    fireEvent.click(cellButton(HER_EMAIL, 'ARBI', 'Neraca'));

    // Optimistic: R is on screen while the call is still in the air.
    expect(cellButton(HER_EMAIL, 'ARBI', 'Neraca').textContent).toBe('R');
    const writes = provisionCollaborator.mock.calls.filter(([, body]) => body.action !== 'list');
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual({
      action: 'grant-scope',
      email: HER_EMAIL,
      entityCode: 'ARBI',
      sectionIds: [S1],
      capability: 'read',
    });

    pending.resolve({
      enrolled: true,
      grants: [...HER_GRANTS, { entityCode: 'ARBI', sectionId: S1, capability: 'read' }],
    });
    await waitFor(() => expect(cellButton(HER_EMAIL, 'ARBI', 'Neraca').disabled).toBe(false));
    expect(cellButton(HER_EMAIL, 'ARBI', 'Neraca').textContent).toBe('R');
  });

  it('R → W upgrades in place with grant-scope write', async () => {
    respondWith([HER_ROW], (body) => ({
      grants: [
        { entityCode: 'SAMB', sectionId: S1, capability: 'write' },
        { entityCode: 'SAMB', sectionId: S2, capability: body.capability },
      ],
    }));
    render(<AccessMatrix />);
    await screen.findByText(HER_EMAIL);
    fireEvent.click(cellButton(HER_EMAIL, 'SAMB', 'Laba rugi'));
    await waitFor(() => expect(cellButton(HER_EMAIL, 'SAMB', 'Laba rugi').textContent).toBe('W'));
    const write = provisionCollaborator.mock.calls.find(([, body]) => body.action !== 'list');
    expect(write?.[1]).toMatchObject({ action: 'grant-scope', capability: 'write', sectionIds: [S2] });
  });

  it('W → — sends revoke-scope, and a refusal rolls the cell back and says why', async () => {
    respondWith([HER_ROW], () => ({ error: 'audit write failed' }));
    render(<AccessMatrix />);
    await screen.findByText(HER_EMAIL);

    fireEvent.click(cellButton(HER_EMAIL, 'SAMB', 'Neraca'));
    const write = provisionCollaborator.mock.calls.find(([, body]) => body.action !== 'list');
    expect(write?.[1]).toEqual({
      action: 'revoke-scope',
      email: HER_EMAIL,
      entityCode: 'SAMB',
      sectionId: S1,
    });

    await screen.findByText('audit write failed');
    expect(cellButton(HER_EMAIL, 'SAMB', 'Neraca').textContent).toBe('W');
  });

  it('"semua" grants write on every section of the entity in one call', async () => {
    respondWith([HER_ROW], (body) => ({
      enrolled: true,
      grants: [
        ...HER_GRANTS,
        ...(body.sectionIds as string[]).map((sectionId) => ({
          entityCode: 'ARBI',
          sectionId,
          capability: 'write',
        })),
      ],
    }));
    render(<AccessMatrix />);
    await screen.findByText(HER_EMAIL);
    fireEvent.click(
      screen.getByRole('button', {
        name: `Beri baca + tulis di semua section ARBI untuk ${HER_EMAIL}`,
      }),
    );
    const write = provisionCollaborator.mock.calls.find(([, body]) => body.action !== 'list');
    expect(write?.[1]).toEqual({
      action: 'grant-scope',
      email: HER_EMAIL,
      entityCode: 'ARBI',
      sectionIds: [S1, S2],
      capability: 'write',
    });
    await waitFor(() => expect(cellButton(HER_EMAIL, 'ARBI', 'Laba rugi').textContent).toBe('W'));
    expect(cellButton(HER_EMAIL, 'ARBI', 'Neraca').textContent).toBe('W');
  });

  it('never writes a table through the repository', async () => {
    const repository = useAppStore.getState().repository as unknown as Record<string, unknown>;
    respondWith([HER_ROW], () => ({ grants: HER_GRANTS }));
    render(<AccessMatrix />);
    await screen.findByText(HER_EMAIL);
    fireEvent.click(cellButton(HER_EMAIL, 'ARBI', 'Neraca'));
    await waitFor(() => expect(provisionCollaborator.mock.calls.length).toBeGreaterThan(1));
    // The stub carries reads only; had the matrix reached for a write, the
    // call would have thrown "not a function" and surfaced in the notice.
    expect(Object.keys(repository).every((key) => key.startsWith('list'))).toBe(true);
    expect(screen.queryByText(/not a function/)).toBeNull();
  });
});
