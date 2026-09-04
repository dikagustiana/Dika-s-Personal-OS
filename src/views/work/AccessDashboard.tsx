import { KeyRound, Link2, Lock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { lockApp, readStoredKey } from '../../components/PassphraseGate';
import {
  collabLinkStatus,
  describeCollabLink,
  linkStatusFromState,
  mergeCollabLinks,
} from '../../data/collabLinkVault';
import { readThrew, rowsOf, type ReadResult } from '../../data/readResult';
import {
  isSupabaseConfigured,
  provisionCollaborator,
  type ProvisionedUser,
} from '../../data/supabaseRepository';
import type {
  CollabLink,
  FinishLineEntity,
  FinishLineItem,
  ScopeCapability,
  ScopeGrant,
  ShareLink,
  SignInEvent,
} from '../../data/types';
import { useMutation } from '../../hooks/useMutation';
import { cn } from '../../lib/utils';
import {
  applyGrant,
  CAPABILITY_GLYPH,
  capabilityAt,
  describeCapability,
  lastSignIn,
  nextCapability,
  removeGrant,
  sectionColumns,
  shortInstant,
  type MatrixCapability,
} from '../../logic/accessMatrix';
import { useAppStore } from '../../store/appStore';
import { CouldNotCheck } from './finishLineUi';
import { ShareLinkCard } from './ShareLinkCard';

/**
 * ===========================================================================
 * THE ACCESS DASHBOARD — who reads or writes which section of which entity.
 * ===========================================================================
 * One row per person, one column per (entity, section), one glyph per cell:
 * `—` no grant, `R` read, `W` read + write. A click walks the cell one step
 * around the cycle — → R → W → — and each step is ONE audited call to the
 * provisioning function (grant-scope or revoke-scope). "semua" beside each
 * entity grants write on every section of it in one call.
 *
 * OPTIMISTIC, WITH A ROLLBACK. The cell changes the instant it is clicked
 * and the call goes out behind it; if the call fails the cell goes back to
 * the snapshot taken before the click and the failure is said in the notice
 * line. Success replaces the local rows with the ones the server returned,
 * so the matrix always ends on the database's truth, never on its own.
 *
 * WHAT IT WILL NOT DO. It never writes a table directly: every change goes
 * through the same owner-key-gated, service-role, audited function the
 * collaborator panel uses, and a dead panel session renders one explicit
 * re-unlock banner instead of a matrix that silently no-ops. It never shows a
 * confident nothing for a person whose grants it could not read — a build of
 * the function that predates the scope axis, or a database where the table
 * is not yet there, renders "tidak bisa dicek" across the row, not a row of
 * dashes.
 *
 * The second tab lists the read-only share links (private.os_share_links,
 * through the gated repository reads) and lets the owner revoke or extend
 * them. It mints whole-Finish-line links only: an entity-scoped link is
 * minted from the Finish line at that entity's level, where the owner can see
 * exactly which column they are about to share.
 */

type Tab = 'akses' | 'tautan';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'akses', label: 'Akses' },
  { id: 'tautan', label: 'Tautan berbagi' },
];

/** How often the link-status column re-reads the clock. */
const CLOCK_TICK_MS = 30_000;

const unread = <T,>(): ReadResult<T> => ({ ok: false, reason: 'failed', detail: 'Not read yet' });

export function AccessDashboard() {
  const [tab, setTab] = useState<Tab>('akses');
  return (
    <div className="page-shell">
      <header className="mb-6 border-b border-border-subtle pb-6">
        <p className="page-kicker">Work / Akses</p>
        <h1 className="page-title">Akses kolaborator</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
          Siapa boleh membaca atau menulis section mana di entity mana. Tiap klik adalah satu
          aksi yang dicatat; membership tetap urusan panel Kolaborator di Finish line.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-border-subtle" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'min-h-10 border-b-2 px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === item.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground-secondary',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'akses' ? <AccessMatrix /> : <ShareLinksTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE MATRIX
// ---------------------------------------------------------------------------

/** A short column heading; the full section name travels in the title. */
function abbreviate(label: string): string {
  return label.length <= 14 ? label : `${label.slice(0, 13)}…`;
}

export function AccessMatrix() {
  const repository = useAppStore((state) => state.repository);
  const [users, setUsers] = useState<ProvisionedUser[] | null>(null);
  const [entities, setEntities] = useState<ReadResult<FinishLineEntity>>(unread);
  const [items, setItems] = useState<ReadResult<FinishLineItem>>(unread);
  const [signIns, setSignIns] = useState<ReadResult<SignInEvent>>(unread);
  const [storedLinks, setStoredLinks] = useState<ReadResult<CollabLink>>(unread);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionDead, setSessionDead] = useState(false);
  // Cells with a call in flight, keyed user|entity|section. Only those are
  // disabled: the rest of the matrix stays clickable while one call runs.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const call = useCallback(
    async <T,>(fn: (appKey: string) => Promise<T>): Promise<T | undefined> => {
      const appKey = readStoredKey();
      if (!appKey) {
        setSessionDead(true);
        setNotice('Sesi panel kedaluwarsa — buka kunci ulang untuk melanjutkan.');
        return undefined;
      }
      setNotice(null);
      try {
        return await fn(appKey);
      } catch {
        setNotice('Tidak bisa menghubungi fungsi provisioning.');
        return undefined;
      }
    },
    [],
  );

  const load = useCallback(async () => {
    const [loadedEntities, loadedItems, loadedSignIns, loadedLinks] = await Promise.all([
      repository.listFinishLineEntities(),
      repository.listFinishLineItems(),
      repository.listSignInLog(),
      repository.listCollabLinks(),
    ]);
    setEntities(loadedEntities);
    setItems(loadedItems);
    setSignIns(loadedSignIns);
    setStoredLinks(loadedLinks);
    if (isSupabaseConfigured) {
      const result = await call((appKey) => provisionCollaborator(appKey, { action: 'list' }));
      if (result) {
        if (result.error) setNotice(result.error);
        else {
          setUsers(result.users ?? []);
          setSessionDead(false);
        }
      }
    }
    setLoaded(true);
  }, [call, repository]);

  useEffect(() => {
    void load().catch((error: unknown) => {
      const failure = readThrew('access dashboard', error);
      setEntities(failure);
      setItems(failure);
      setSignIns(failure);
      setStoredLinks(failure);
      setLoaded(true);
    });
  }, [load]);

  const entityRows = useMemo(
    () => [...rowsOf(entities)].sort((a, b) => a.order - b.order),
    [entities],
  );
  const sections = useMemo(() => sectionColumns(rowsOf(items)), [items]);
  const linksByUser = useMemo(() => {
    const map = new Map<string, CollabLink>();
    for (const row of rowsOf(storedLinks)) map.set(row.userId, row);
    return map;
  }, [storedLinks]);

  const patchUser = (userId: string, patch: Partial<ProvisionedUser>) =>
    setUsers((current) =>
      current ? current.map((user) => (user.userId === userId ? { ...user, ...patch } : user)) : current,
    );

  const withBusy = (key: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  /**
   * One click, one step around the cycle, one audited call. The snapshot is
   * the person's grants BEFORE the click; a failed call puts it back.
   */
  const cycle = async (user: ProvisionedUser, entityCode: string, sectionId: string) => {
    const snapshot = user.grants;
    if (!snapshot) return;
    const current = capabilityAt(snapshot, entityCode, sectionId);
    const next = nextCapability(current);
    const optimistic =
      next === 'none'
        ? removeGrant(snapshot, entityCode, sectionId)
        : applyGrant(snapshot, entityCode, [sectionId], next);
    const key = `${user.userId}|${entityCode}|${sectionId}`;
    patchUser(user.userId, { grants: optimistic });
    withBusy(key, true);
    const result = await call((appKey) =>
      provisionCollaborator(
        appKey,
        next === 'none'
          ? { action: 'revoke-scope', email: user.email, entityCode, sectionId }
          : { action: 'grant-scope', email: user.email, entityCode, sectionIds: [sectionId], capability: next },
      ),
    );
    withBusy(key, false);
    if (!result || result.error) {
      patchUser(user.userId, { grants: snapshot });
      if (result?.error) setNotice(result.error);
      return;
    }
    patchUser(user.userId, {
      grants: result.grants ?? optimistic,
      entityCodes: result.enrolled
        ? [...new Set([...user.entityCodes, entityCode])].sort()
        : user.entityCodes,
    });
  };

  /** Write on every section of one entity, for one person, in one call. */
  const grantAll = async (user: ProvisionedUser, entityCode: string) => {
    const snapshot = user.grants;
    if (!snapshot || sections.length === 0) return;
    const sectionIds = sections.map((section) => section.id);
    const capability: ScopeCapability = 'write';
    const optimistic = applyGrant(snapshot, entityCode, sectionIds, capability);
    const key = `${user.userId}|${entityCode}|*`;
    patchUser(user.userId, { grants: optimistic });
    withBusy(key, true);
    const result = await call((appKey) =>
      provisionCollaborator(appKey, {
        action: 'grant-scope',
        email: user.email,
        entityCode,
        sectionIds,
        capability,
      }),
    );
    withBusy(key, false);
    if (!result || result.error) {
      patchUser(user.userId, { grants: snapshot });
      if (result?.error) setNotice(result.error);
      return;
    }
    patchUser(user.userId, {
      grants: result.grants ?? optimistic,
      entityCodes: result.enrolled
        ? [...new Set([...user.entityCodes, entityCode])].sort()
        : user.entityCodes,
    });
  };

  /**
   * The status column. The server's verdict wins when it has one — it reads
   * GoTrue's own token table through a definer RPC and knows the configured
   * window. Otherwise, the same local inference the collaborator panel uses,
   * from the stored link row and the sign-in time.
   */
  const linkLine = (user: ProvisionedUser): string => {
    const signedIn = lastSignIn(user.userId, signIns, user.lastSignInAt);
    if (user.link) {
      const fromServer = linkStatusFromState(user.link, now);
      if (fromServer) return describeCollabLink(fromServer);
    }
    const stored = linksByUser.get(user.userId);
    const held = stored
      ? mergeCollabLinks(
          [
            {
              email: user.email,
              url: stored.link,
              mintedAt: Date.parse(stored.createdAt),
              expiresAt: stored.expiresAt === null ? null : Date.parse(stored.expiresAt),
              usedAt: stored.usedAt === null ? null : Date.parse(stored.usedAt),
            },
          ],
          {},
        )[user.email.trim().toLowerCase()] ?? null
      : null;
    if (!held && user.link?.status === 'unknown') return 'status tautan tidak diketahui';
    return describeCollabLink(collabLinkStatus(held, signedIn.at, now));
  };

  const columnsPerEntity = sections.length + 1;
  const structureKnown = entities.ok && items.ok && sections.length > 0;

  if (!isSupabaseConfigured) {
    return (
      <Card>
        <CardContent className="pt-5">
          <p className="surface-label">Akses</p>
          <p className="mt-2 text-xs leading-5 text-foreground-muted">
            Dashboard akses membaca dan menulis lewat fungsi provisioning, yang hanya ada di
            database live. Di mode mock tidak ada kolaborator untuk ditampilkan.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="surface-label flex items-center gap-2">
              <KeyRound className="size-3.5" />
              Matriks akses
            </p>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              Klik sel untuk memutar — → R → W → —. Setiap klik satu aksi tercatat. <b>semua</b>{' '}
              memberi baca + tulis di setiap section entity itu.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={sessionDead}>
            <RefreshCw className="size-3.5" />
            Muat ulang
          </Button>
        </div>

        {sessionDead && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-[11px] leading-4 text-foreground-secondary">
              Sesi panel kedaluwarsa (12 jam). Tidak ada yang dikirim atau diubah — buka kunci
              ulang, lalu ulangi aksinya.
            </p>
            <Button variant="secondary" size="sm" onClick={() => lockApp()}>
              <Lock className="size-3.5" />
              Buka kunci ulang
            </Button>
          </div>
        )}

        {loaded && !entities.ok && (
          <div className="mt-3">
            <CouldNotCheck label="Entity" failure={entities} />
          </div>
        )}
        {loaded && !items.ok && (
          <div className="mt-3">
            <CouldNotCheck label="Section" failure={items} />
          </div>
        )}
        {loaded && entities.ok && items.ok && sections.length === 0 && (
          <p className="mt-3 text-[11px] text-foreground-muted">
            Tidak ada section di struktur Finish line — tidak ada kolom untuk digambar.
          </p>
        )}

        <div className="mt-3 border-t border-border-subtle pt-3">
          {users === null ? (
            <p className="text-[11px] text-foreground-muted">
              {sessionDead ? 'Daftar tidak dimuat — sesi terkunci.' : 'Memuat daftar…'}
            </p>
          ) : users.length === 0 ? (
            <p className="text-[11px] text-foreground-muted">Belum ada kolaborator.</p>
          ) : structureKnown ? (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-[11px]">
                <thead>
                  <tr>
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left align-bottom font-semibold text-foreground-muted"
                    >
                      Orang
                    </th>
                    <th
                      rowSpan={2}
                      className="px-2 py-1.5 text-left align-bottom font-semibold text-foreground-muted"
                    >
                      Status tautan
                    </th>
                    {entityRows.map((entity) => (
                      <th
                        key={entity.code}
                        colSpan={columnsPerEntity}
                        scope="colgroup"
                        title={entity.label}
                        className="border-l border-border-subtle px-2 py-1.5 text-center font-semibold uppercase tracking-[0.08em] text-foreground-secondary"
                      >
                        {entity.code}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {entityRows.flatMap((entity) => [
                      ...sections.map((section, index) => (
                        <th
                          key={`${entity.code}|${section.id}`}
                          scope="col"
                          title={section.item}
                          className={cn(
                            'px-1 py-1 text-center text-[10px] font-medium text-foreground-muted',
                            index === 0 && 'border-l border-border-subtle',
                          )}
                        >
                          {abbreviate(section.item)}
                        </th>
                      )),
                      <th
                        key={`${entity.code}|all`}
                        scope="col"
                        className="px-1 py-1 text-center text-[10px] font-medium text-foreground-muted"
                      >
                        semua
                      </th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const signedIn = lastSignIn(user.userId, signIns, user.lastSignInAt);
                    return (
                      <tr key={user.userId} className="border-t border-border-subtle">
                        <td className="sticky left-0 z-10 bg-card px-2 py-2 align-top">
                          <span className="block min-w-0 max-w-[16rem] break-words font-medium text-foreground">
                            {user.email}
                          </span>
                          <span
                            className={cn(
                              'mt-0.5 inline-block rounded-sm border px-1.5 py-0.5 text-[10px] tabular-nums',
                              signedIn.source === 'none'
                                ? 'border-escalate/40 bg-escalate/10 text-escalate'
                                : 'border-border text-foreground-muted',
                            )}
                          >
                            {signedIn.at ? `masuk ${shortInstant(signedIn.at)}` : 'belum pernah masuk'}
                          </span>
                        </td>
                        <td className="px-2 py-2 align-top text-[10px] leading-4 tabular-nums text-foreground-secondary">
                          {linkLine(user)}
                        </td>
                        {user.grants === undefined ? (
                          <td
                            colSpan={entityRows.length * columnsPerEntity}
                            className="border-l border-border-subtle px-2 py-2 align-top text-[10px] leading-4 text-escalate"
                          >
                            Tidak bisa dicek — fungsi provisioning tidak mengirim daftar grant
                            (build lama, atau tabel grant belum ada). Bukan berarti tidak punya
                            akses.
                          </td>
                        ) : (
                          entityRows.flatMap((entity) => {
                            const grants = user.grants as ScopeGrant[];
                            return [
                              ...sections.map((section, index) => {
                                const capability = capabilityAt(grants, entity.code, section.id);
                                const key = `${user.userId}|${entity.code}|${section.id}`;
                                const pending = busy.has(key) || busy.has(`${user.userId}|${entity.code}|*`);
                                return (
                                  <td
                                    key={key}
                                    className={cn(
                                      'px-1 py-1 text-center align-top',
                                      index === 0 && 'border-l border-border-subtle',
                                    )}
                                  >
                                    <CapabilityCell
                                      capability={capability}
                                      pending={pending}
                                      disabled={sessionDead}
                                      label={`${user.email} · ${entity.code} · ${section.item}: ${describeCapability(capability)} — klik untuk ${describeCapability(nextCapability(capability))}`}
                                      onClick={() => void cycle(user, entity.code, section.id)}
                                    />
                                  </td>
                                );
                              }),
                              <td key={`${user.userId}|${entity.code}|all`} className="px-1 py-1 text-center align-top">
                                <button
                                  type="button"
                                  disabled={sessionDead || busy.has(`${user.userId}|${entity.code}|*`)}
                                  onClick={() => void grantAll(user, entity.code)}
                                  aria-label={`Beri baca + tulis di semua section ${entity.code} untuk ${user.email}`}
                                  title={`Beri baca + tulis di semua section ${entity.code}`}
                                  className="min-h-7 min-w-7 rounded-sm border border-dashed border-border px-1 text-[10px] font-semibold text-foreground-muted transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  W
                                </button>
                              </td>,
                            ];
                          })
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            loaded && (
              <p className="text-[11px] text-foreground-muted">
                Matriks tidak digambar karena struktur entity/section tidak terbaca.
              </p>
            )
          )}
        </div>

        <p className="mt-3 text-[10px] leading-4 text-foreground-muted">
          Metric tanpa section (COGS / Sales × Poultry processing / Poultry trading) tidak bisa
          diberikan ke siapa pun dan tetap milik pemilik. Baris baru yang belum ter-enrol di
          suatu entity akan di-enrol saat section pertamanya diberikan.
        </p>

        <div
          role="status"
          aria-live="polite"
          className="mt-2 text-[11px] text-foreground-secondary empty:hidden"
        >
          {notice}
        </div>
      </CardContent>
    </Card>
  );
}

function CapabilityCell({
  capability,
  pending,
  disabled,
  label,
  onClick,
}: {
  capability: MatrixCapability;
  pending: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      aria-label={label}
      title={label}
      className={cn(
        'min-h-7 min-w-7 rounded-sm border px-1.5 text-[10px] font-semibold tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
        capability === 'write'
          ? 'border-primary bg-primary/10 text-primary'
          : capability === 'read'
            ? 'border-primary/40 text-foreground-secondary'
            : 'border-border-subtle text-foreground-muted hover:border-border hover:text-foreground-secondary',
        pending && 'opacity-50',
      )}
    >
      {CAPABILITY_GLYPH[capability]}
    </button>
  );
}

// ---------------------------------------------------------------------------
// THE SHARE-LINK TAB
// ---------------------------------------------------------------------------

function ShareLinksTab() {
  const repository = useAppStore((state) => state.repository);
  const { run, isPending } = useMutation();
  const [links, setLinks] = useState<ReadResult<ShareLink>>(unread);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setLinks(await repository.listShareLinks());
    } catch (error: unknown) {
      setLinks(readThrew('listShareLinks', error));
    }
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <p className="flex items-start gap-2 text-xs leading-5 text-foreground-muted">
        <Link2 className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Tautan berbagi bersifat baca saja dan anonim: siapa pun yang memegangnya melihat satu
          tampilan sampai kedaluwarsa. Dari sini yang dibuat adalah tautan <b>seluruh</b> Finish
          line; tautan satu entity dibuat dari Finish line pada level entity itu, supaya kolom
          yang dibagikan terlihat saat dibuat.
        </span>
      </p>
      <ShareLinkCard
        level="group"
        links={links}
        loaded={loaded}
        isPending={isPending}
        onCreate={async (input) => {
          const created = await run('Create share link', () => repository.createShareLink(input));
          if (created === undefined) return false;
          await load();
          return true;
        }}
        onRevoke={async (id) => {
          const done = await run('Revoke share link', () => repository.revokeShareLink(id));
          if (done === undefined) return false;
          await load();
          return true;
        }}
        onExtend={async (id, ttlDays) => {
          const done = await run('Extend share link', () =>
            repository.extendShareLink(id, ttlDays),
          );
          if (done === undefined) return false;
          await load();
          return true;
        }}
      />
    </>
  );
}
