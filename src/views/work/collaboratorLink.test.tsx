// @vitest-environment jsdom
/**
 * §8 from the panel's side: can the owner actually get a working link into
 * someone's hands, and get it BACK if they look away?
 *
 * The bug this suite pins is not "the link is hard to find". It is that a
 * lost link costs someone else their access: auth.one_time_tokens holds a
 * UNIQUE index on (user_id, token_type), so minting a replacement kills the
 * token already sent. The first test is therefore the important one — after a
 * full unmount and remount, the link must come back WITHOUT a second mint,
 * and the assertion that proves it is the call count, not the pixels.
 *
 * The rest guard the things that are easy to regress quietly: that the link
 * is masked while still being copyable, that "Tautan baru" says what it
 * destroys before it destroys it, and that no code path breathes the token
 * into a log.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows, readAbsence, readFailure, type ReadResult } from '../../data/readResult';
import type { CollabLink, FinishLineEntity } from '../../data/types';
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

const TOKEN = 'SECRET_TOKEN_VALUE_123';
const LINK = `https://os.example.app/#collab_token=${TOKEN}`;

const ENTITIES: FinishLineEntity[] = [
  { code: 'SAMB', label: 'Sambungan', order: 1 },
  { code: 'ARBI', label: 'Arbitrase', order: 2 },
];

interface Row {
  userId: string;
  email: string;
  entityCodes: string[];
  projectIds: string[];
  lastSignInAt: string | null;
  createdAt: string | null;
}

const OWNER_ROW: Row = {
  userId: 'u-1',
  email: 'dika.g.irawan@gmail.com',
  entityCodes: ['ARBI', 'SAMB'],
  projectIds: [],
  lastSignInAt: null,
  createdAt: '2026-08-05T14:03:07.000Z',
};

/** No entities, no projects — the `ENTITAS tidak ada` row from the report. */
const GRANTLESS_ROW: Row = {
  userId: 'u-2',
  email: 'kucingkuroshiro+asi-selftest@gmail.com',
  entityCodes: [],
  projectIds: [],
  lastSignInAt: '2026-08-04T16:45:33.000Z',
  createdAt: '2026-08-04T16:43:15.000Z',
};

/** Project grants but no entity membership — the client/server mismatch. */
const PROJECT_ONLY_ROW: Row = {
  userId: 'u-3',
  email: 'projects.only@example.com',
  entityCodes: [],
  projectIds: ['11111111-1111-4111-8111-111111111111'],
  lastSignInAt: null,
  createdAt: '2026-08-05T09:00:00.000Z',
};

function respondWith(rows: Row[]) {
  provisionCollaborator.mockImplementation(
    async (_key: string, body: { action: string; email?: string }) => {
      if (body.action === 'list') return { users: rows };
      if (body.action === 'link' || body.action === 'create') {
        return { email: body.email, link: LINK, expiry: 'Sekali pakai.' };
      }
      if (body.action === 'revoke') return { removedEntityCodes: [], removedProjectIds: [] };
      return {};
    },
  );
}

function mountCard() {
  return render(<CollaboratorCard entities={ENTITIES} />);
}

const linkField = () => screen.getByLabelText(/Tautan masuk kolaborator/i) as HTMLInputElement;

/** Plain DOM rather than a jest-dom matcher — this repo does not carry one. */
const isDisabled = (name: RegExp) =>
  (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

let writeText: ReturnType<typeof vi.fn>;
/**
 * What listCollabLinks answers, swapped per test. Held in a variable rather
 * than by replacing the repository OBJECT: replacing it re-renders the card
 * mid-flight, and a refresh already in the air then lands after the swap and
 * overwrites it. One stable object, one mutable answer.
 */
let storedLinksResult: ReadResult<CollabLink>;

beforeEach(() => {
  window.sessionStorage.clear();
  provisionCollaborator.mockReset();
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  // Default: migration 20260809000071 has NOT been applied, which is the state
  // this bundle ships into. Everything above therefore still pins the
  // tab-local fallback — the behaviour that has to keep working before the
  // table exists.
  storedLinksResult = readAbsence('listCollabLinks', { code: '42P01' });
  useAppStore.setState({
    repository: {
      listProjects: async () => [],
      listCollabLinks: async () => storedLinksResult,
    } as unknown as Repository,
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  respondWith([OWNER_ROW]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mintLink() {
  await screen.findByText(OWNER_ROW.email);
  fireEvent.click(screen.getByRole('button', { name: /Tautan baru/i }));
  await waitFor(() => expect(linkField()).toBeTruthy());
}

describe('a minted link survives leaving the page — the reported failure', () => {
  it('comes back after a full unmount, and mints nothing to do it', async () => {
    mountCard();
    await mintLink();
    expect(linkField().value).toContain('•');

    // Navigate away. React state is gone; only the vault remains.
    cleanup();
    mountCard();
    await screen.findByText(OWNER_ROW.email);

    // The row offers it back, and taking it does NOT call the server.
    const reopen = await screen.findByRole('button', { name: /Lihat tautan/i });
    fireEvent.click(reopen);
    await waitFor(() => expect(linkField()).toBeTruthy());

    const mints = provisionCollaborator.mock.calls.filter(
      ([, body]) => (body as { action: string }).action === 'link',
    );
    expect(mints).toHaveLength(1);
  });

  it('offers no re-open when nothing was ever minted', async () => {
    mountCard();
    await screen.findByText(OWNER_ROW.email);
    expect(screen.queryByRole('button', { name: /Lihat tautan/i })).toBeNull();
  });

  it('stops offering a link once it has expired', async () => {
    mountCard();
    await mintLink();
    cleanup();

    // Push the stored deadline into the past, exactly as an hour passing does.
    const raw = JSON.parse(window.sessionStorage.getItem('personal-os-collab-links') ?? '{}');
    raw[OWNER_ROW.email].expiresAt = Date.now() - 1;
    window.sessionStorage.setItem('personal-os-collab-links', JSON.stringify(raw));

    mountCard();
    await screen.findByText(OWNER_ROW.email);
    expect(screen.queryByRole('button', { name: /Lihat tautan/i })).toBeNull();
  });
});

describe('the link is closed by default and opened deliberately', () => {
  it('masks the token but keeps the destination legible', async () => {
    mountCard();
    await mintLink();
    const value = linkField().value;
    expect(value).not.toContain(TOKEN);
    expect(value).toContain('https://os.example.app/#collab_token=');
  });

  it('reveals only when asked, and re-hides', async () => {
    mountCard();
    await mintLink();
    fireEvent.click(screen.getByRole('button', { name: /^Lihat$/i }));
    await waitFor(() => expect(linkField().value).toBe(LINK));
    fireEvent.click(screen.getByRole('button', { name: /Sembunyikan/i }));
    await waitFor(() => expect(linkField().value).not.toContain(TOKEN));
  });

  it('copies the REAL link while it is still masked', async () => {
    mountCard();
    await mintLink();
    expect(linkField().value).not.toContain(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: /Salin/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
  });

  it('re-masks when the panel is closed and opened again', async () => {
    mountCard();
    await mintLink();
    fireEvent.click(screen.getByRole('button', { name: /^Lihat$/i }));
    await waitFor(() => expect(linkField().value).toBe(LINK));
    fireEvent.click(screen.getByRole('button', { name: /Tutup/i }));
    await waitFor(() => expect(screen.queryByLabelText(/Tautan masuk kolaborator/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Lihat tautan/i }));
    await waitFor(() => expect(linkField().value).not.toContain(TOKEN));
  });

  it('stays put until closed — nothing dismisses it on a timer', async () => {
    vi.useFakeTimers();
    try {
      mountCard();
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.click(screen.getByRole('button', { name: /Tautan baru/i }));
      await vi.advanceTimersByTimeAsync(0);
      expect(linkField()).toBeTruthy();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(linkField()).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('"Tautan baru" says what it destroys, first', () => {
  it('warns that the previous link dies, before calling anything', async () => {
    mountCard();
    await screen.findByText(OWNER_ROW.email);
    fireEvent.click(screen.getByRole('button', { name: /Tautan baru/i }));
    const asked = (window.confirm as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(asked).toMatch(/LANGSUNG BATAL/);
    expect(asked).toMatch(/gagal masuk/);
  });

  it('mints nothing when the warning is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mountCard();
    await screen.findByText(OWNER_ROW.email);
    fireEvent.click(screen.getByRole('button', { name: /Tautan baru/i }));
    await waitFor(() =>
      expect(
        provisionCollaborator.mock.calls.filter(
          ([, body]) => (body as { action: string }).action === 'link',
        ),
      ).toHaveLength(0),
    );
  });

  it('re-opening an existing link asks nothing — it destroys nothing', async () => {
    mountCard();
    await mintLink();
    (window.confirm as unknown as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Tutup/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Lihat tautan/i }));
    await waitFor(() => expect(linkField()).toBeTruthy());
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe('rows without entity membership', () => {
  it('explains the dimmed link button in the open, not only in a tooltip', async () => {
    respondWith([GRANTLESS_ROW]);
    mountCard();
    await screen.findByText(GRANTLESS_ROW.email);
    expect(isDisabled(/Tautan baru/i)).toBe(true);
    expect(screen.getByText(/Tanpa entitas, tautan masuk tidak dibuat/i)).toBeTruthy();
  });

  it('dims Cabut only when there is genuinely nothing to revoke', async () => {
    respondWith([GRANTLESS_ROW]);
    mountCard();
    await screen.findByText(GRANTLESS_ROW.email);
    expect(isDisabled(/^Cabut$/i)).toBe(true);
  });

  it('keeps Cabut LIVE for a project-only user while the link stays refused', async () => {
    // The old gate counted project grants toward "can mint a link", but the
    // server only looks at entity membership — so this row used to offer a
    // button that could only ever return 409, and hid the revoke that would
    // actually have worked.
    respondWith([PROJECT_ONLY_ROW]);
    mountCard();
    await screen.findByText(PROJECT_ONLY_ROW.email);
    expect(isDisabled(/Tautan baru/i)).toBe(true);
    expect(isDisabled(/^Cabut$/i)).toBe(false);
  });
});

describe('per-row status is actionable', () => {
  it('says the window is UNKNOWN when the server sent no deadline', async () => {
    // The old assertion here was `berlaku N menit lagi`, produced by a
    // one-hour default this module no longer has. At an 86400s OTP window that
    // default called a link dead with twenty-three hours left — and the fix
    // for a dead link is a re-mint, which cuts off whoever holds the real one.
    mountCard();
    await mintLink();
    expect(screen.getAllByText(/masa berlaku tidak diketahui/i).length).toBeGreaterThan(0);
  });

  it('counts down when the server DOES send a deadline', async () => {
    provisionCollaborator.mockImplementation(
      async (_key: string, body: { action: string; email?: string }) => {
        if (body.action === 'list') return { users: [OWNER_ROW] };
        if (body.action === 'link' || body.action === 'create') {
          return {
            email: body.email,
            link: LINK,
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          };
        }
        return {};
      },
    );
    mountCard();
    await mintLink();
    expect(screen.getAllByText(/berlaku sampai \d{2}:\d{2}/i).length).toBeGreaterThan(0);
  });

  it('reports a link as spent once the person signs in after it was minted', async () => {
    mountCard();
    await mintLink();
    cleanup();
    // Same link, but the list now shows a sign-in later than the mint.
    respondWith([{ ...OWNER_ROW, lastSignInAt: new Date(Date.now() + 60_000).toISOString() }]);
    mountCard();
    expect(await screen.findByText(/tautan sudah dipakai/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lihat tautan/i })).toBeNull();
  });
});

describe('revoke and the vault', () => {
  it('drops the held link, because the grants it opened are gone', async () => {
    mountCard();
    await mintLink();
    fireEvent.click(screen.getByRole('button', { name: /^Cabut$/i }));
    await waitFor(() =>
      expect(window.sessionStorage.getItem('personal-os-collab-links')).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText(/Tautan masuk kolaborator/i)).toBeNull(),
    );
  });
});

describe('the token never leaks into a log', () => {
  it('keeps it out of console across mint, reveal, copy and revoke', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
    mountCard();
    await mintLink();
    fireEvent.click(screen.getByRole('button', { name: /^Lihat$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Salin/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Cabut$/i }));
    await waitFor(() =>
      expect(window.sessionStorage.getItem('personal-os-collab-links')).toBeNull(),
    );
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(TOKEN);
      }
    }
  });

  it('reports a copy failure without quoting the link', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    mountCard();
    await mintLink();
    fireEvent.click(screen.getByRole('button', { name: /Salin/i }));
    const notice = await screen.findByText(/Tidak bisa menyalin otomatis/i);
    expect(notice.textContent ?? '').not.toContain(TOKEN);
  });
});

// --- the durable half: public.os_collab_links -------------------------------
//
// Everything above pins the TAB copy, which is what ships before migration
// 20260809000071. These pin what the stored row adds, and the first one is the
// whole reason the table exists: sessionStorage dies with the tab, and a link
// that dies with the tab still forces a re-mint — which is what cuts off
// whoever is holding the current link.

const STORED_ROW: CollabLink = {
  userId: OWNER_ROW.userId,
  link: LINK,
  createdAt: '2026-08-09T10:00:00.000Z',
  expiresAt: '2026-08-10T10:00:00.000Z',
  usedAt: null,
};

function withStoredLinks(rows: CollabLink[]) {
  storedLinksResult = okRows(rows);
}

describe('a stored link outlives the tab that minted it', () => {
  it('comes back after sessionStorage is gone, with the same value, minting nothing', async () => {
    withStoredLinks([STORED_ROW]);
    mountCard();
    await screen.findByText(OWNER_ROW.email);

    // Closing the tab: the vault is what does NOT survive that.
    window.sessionStorage.clear();
    cleanup();
    mountCard();
    await screen.findByText(OWNER_ROW.email);

    fireEvent.click(await screen.findByRole('button', { name: /Lihat tautan/i }));
    await waitFor(() => expect(linkField()).toBeTruthy());
    // Masked, as ever.
    expect(linkField().value).not.toContain(TOKEN);
    // And the copy is the REAL link — same value the owner had before.
    fireEvent.click(screen.getByRole('button', { name: /Salin/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));

    const mints = provisionCollaborator.mock.calls.filter(
      ([, body]) => (body as { action: string }).action === 'link',
    );
    expect(mints).toHaveLength(0);
  });

  it('reports a spent link from the stored stamp, not from a guess', async () => {
    withStoredLinks([{ ...STORED_ROW, usedAt: '2026-08-09T11:00:00.000Z' }]);
    mountCard();
    expect(await screen.findByText(/tautan sudah dipakai/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lihat tautan/i })).toBeNull();
  });

  it('says the window is unknown rather than inventing a countdown', async () => {
    // COLLAB_LINK_TTL_SECONDS unset on the function: no deadline to store.
    withStoredLinks([{ ...STORED_ROW, expiresAt: null }]);
    mountCard();
    expect(await screen.findByText(/masa berlaku tidak diketahui/i)).toBeTruthy();
    // Unknown is NOT expired — the link is still offered.
    expect(screen.getByRole('button', { name: /Lihat tautan/i })).toBeTruthy();
  });

  it('shows the four row states in words', async () => {
    withStoredLinks([]);
    mountCard();
    expect(await screen.findByText(/belum ada tautan/i)).toBeTruthy();
  });

  it('drops the row once Cabut has removed it server-side', async () => {
    withStoredLinks([STORED_ROW]);
    mountCard();
    await screen.findByRole('button', { name: /Lihat tautan/i });
    // The Edge Function deletes the row; the refresh after revoke reads none.
    withStoredLinks([]);
    fireEvent.click(screen.getByRole('button', { name: /^Cabut$/i }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Lihat tautan/i })).toBeNull(),
    );
    expect(await screen.findByText(/belum ada tautan/i)).toBeTruthy();
  });
});

describe('the stored table is not there yet, or cannot be read', () => {
  it('renders the card normally on 42P01 and says nothing to the console', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
    storedLinksResult = readAbsence('listCollabLinks', { code: '42P01' });
    mountCard();
    await screen.findByText(OWNER_ROW.email);
    // The row is there, the controls are there, no stored link section.
    expect(screen.getByRole('button', { name: /Tautan baru/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lihat tautan/i })).toBeNull();
    expect(screen.queryByText(/42P01/)).toBeNull();
    expect(screen.queryByText(/tidak terbaca/i)).toBeNull();
    for (const spy of spies) expect(spy.mock.calls).toHaveLength(0);
  });

  it('surfaces a genuine read failure instead of showing an empty state', async () => {
    storedLinksResult = readFailure('listCollabLinks', {
      code: '42501',
      message: 'permission denied for table os_collab_links',
    });
    mountCard();
    const notice = await screen.findByText(/Tautan tersimpan tidak terbaca/i);
    expect(notice.textContent ?? '').toContain('42501');
    expect(notice.textContent ?? '').not.toContain(TOKEN);
  });
});
