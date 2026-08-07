import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Link2,
  Lock,
  RefreshCw,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { lockApp, readStoredKey } from '../../components/PassphraseGate';
import {
  provisionCollaborator,
  type ProvisionedUser,
} from '../../data/supabaseRepository';
import {
  collabLinkStatus,
  describeCollabLink,
  forgetCollabLink,
  maskCollabLink,
  normalizeVaultEmail,
  recallAllCollabLinks,
  rememberCollabLink,
  type CollabLinkVault,
  type StoredCollabLink,
} from '../../data/collabLinkVault';
import type { Engagement, FinishLineEntity, Project } from '../../data/types';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';

/**
 * OWNER-PROVISIONED COLLABORATOR ACCESS — the management panel.
 *
 * The app never sends email. Create mints the account, grants membership and
 * RETURNS a one-time sign-in link; the owner copies it and hands it over on
 * WhatsApp. Links are short-lived, so "Tautan baru" will be used far more
 * often than create — it is one click per row.
 *
 * EVERY GRANT-CHANGING CALL goes to the provision-collaborator Edge Function,
 * which verifies the owner passphrase server-side (same bcrypt + lockout as
 * the gate) before touching anything, and appends each action to
 * private.os_provision_log. That includes PROJECT grants since the zero-grant
 * incident: the first cut wrote them straight to the table through the
 * repository, mounted the picker behind Edge-Function state, and when the
 * stored key expired mid-session the picker silently unmounted — the owner
 * attempted grants that never sent a single request. Now the same gate that
 * makes a dead session fail LOUDLY covers every write, and a dead session
 * renders an explicit re-unlock banner instead of a half-empty panel.
 *
 * TWO INDEPENDENT GRANT SETS PER PERSON, labelled apart on purpose: ENTITAS
 * opens Finish line columns, PROYEK opens a project's tasks. Neither implies
 * the other. Project chips are grouped by `engagement` — informing the
 * human; the ENFORCED rule (WORK only, trigger + function + policy) does not
 * depend on this UI, and the picker offering only WORK projects is
 * convenience, not the boundary.
 *
 * Revoke removes MEMBERSHIP ON BOTH AXES — server-side, one audited action —
 * not the auth user: history rows keep their actor, and a membershipless
 * session reads nothing from its next query on.
 *
 * ---------------------------------------------------------------------------
 * THE MINTED LINK IS THE FRAGILE THING, AND IT IS TREATED AS ONE.
 *
 * A minted link used to live in component state, so navigating off Finish
 * line destroyed it. That is not a cosmetic loss: auth.one_time_tokens holds
 * a UNIQUE index on (user_id, token_type), so there is exactly ONE live token
 * per person and minting a replacement KILLS the one already handed over.
 * Losing a link therefore meant cutting off whoever was holding it. Four
 * rules follow, and each one is load-bearing:
 *
 *   1. A minted link is written to the vault (sessionStorage) and can be
 *      RE-OPENED from its row for as long as it is valid — no re-mint.
 *   2. It renders MASKED. This panel gets screenshotted and sent over chat;
 *      five links in cleartext is five accounts handed out. Reveal and copy
 *      are separate actions, and copy does not require reveal.
 *   3. The panel closes only on a deliberate press, never on a timer.
 *   4. "Tautan baru" says the old link dies BEFORE it runs, not after.
 *
 * No url or token is ever passed to console, a notice, or an error string.
 */

const ENGAGEMENT_GROUPS: Array<{ engagement: Engagement; label: string; caution: boolean }> = [
  { engagement: 'samb', label: 'SAMB', caution: false },
  // A different client's work. Zero rows today; the group exists so a future
  // Gunung Jati project never renders undifferentiated beside SAMB ones.
  { engagement: 'gunungjati', label: 'GUNUNG JATI — klien lain', caution: true },
  // Deliberately grantable (Consolidation & group modeling is meant to be
  // shared) but separated so Decks / Meta / PMO are never a mis-click away.
  { engagement: 'internal', label: 'INTERNAL — proyek pribadi pemilik, cek dua kali', caution: true },
];

/** How often the "berlaku N menit lagi" line re-reads the clock. A countdown
 *  that silently goes stale is worse than no countdown: it would still read
 *  "47 menit lagi" an hour after the link died. */
const CLOCK_TICK_MS = 30_000;

export function CollaboratorCard({ entities }: { entities: FinishLineEntity[] }) {
  const repository = useAppStore((state) => state.repository);
  const [users, setUsers] = useState<ProvisionedUser[] | null>(null);
  const [workProjects, setWorkProjects] = useState<Project[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // The stored key died (12h sessionStorage TTL, per tab). Every panel write
  // needs it; nothing else in the panel can proceed, so this renders one
  // explicit banner with the one action that fixes it.
  const [sessionDead, setSessionDead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [codes, setCodes] = useState<Set<string>>(new Set());
  // Per-user project picker: which row is open, and which projects are ticked.
  const [grantingFor, setGrantingFor] = useState<string | null>(null);
  const [pendingProjects, setPendingProjects] = useState<Set<string>>(new Set());
  // Every link this tab still holds, keyed by address. Seeded from the vault
  // on mount, which is the whole point: the panel survives navigation now.
  const [vault, setVault] = useState<CollabLinkVault>(() => recallAllCollabLinks());
  // Which address's link panel is open. Opening one NEVER mints — it reads
  // what is already held.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // One clock for every countdown on the card. It also re-prunes the vault,
  // so an expired link stops being offered without anyone touching the page.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      setVault(recallAllCollabLinks());
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const call = useCallback(
    async <T,>(fn: (appKey: string) => Promise<T>): Promise<T | undefined> => {
      const appKey = readStoredKey();
      if (!appKey) {
        // Loud, specific, actionable — never a silent no-op. The grant that
        // "failed because the session died" must read as failed.
        setSessionDead(true);
        setNotice('Sesi panel kedaluwarsa — buka kunci ulang untuk melanjutkan.');
        return undefined;
      }
      setBusy(true);
      setNotice(null);
      try {
        return await fn(appKey);
      } catch {
        setNotice('Tidak bisa menghubungi fungsi provisioning.');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    // The project titles come from the repository (owner client, key baked at
    // unlock) and deliberately do NOT depend on the Edge-Function call below —
    // the zero-grant incident began with exactly that coupling.
    try {
      const projects = await repository.listProjects('work');
      setWorkProjects(projects.filter((project) => project.recurring !== 'monthly'));
    } catch {
      setWorkProjects([]);
    }
    const result = await call((appKey) => provisionCollaborator(appKey, { action: 'list' }));
    if (!result) return;
    if (result.error) setNotice(result.error);
    else {
      setUsers(result.users ?? []);
      setSessionDead(false);
    }
  }, [call, repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Records a freshly minted link and opens it, masked. */
  const holdLink = (target: string, url: string, expiresAt?: number) => {
    const stored = rememberCollabLink({ email: target, url, expiresAt });
    setVault(recallAllCollabLinks());
    setOpenFor(stored.email);
    setRevealed(false);
    setCopied(false);
  };

  const create = async () => {
    const trimmed = email.trim();
    if (!trimmed || codes.size === 0) return;
    const result = await call((appKey) =>
      provisionCollaborator(appKey, {
        action: 'create',
        email: trimmed,
        entityCodes: [...codes],
      }),
    );
    if (!result) return;
    if (result.error || !result.link) {
      setNotice(result.error ?? 'Tidak ada tautan yang dihasilkan.');
      return;
    }
    holdLink(result.email ?? trimmed, result.link, expiryFrom(result.expiresAt));
    setEmail('');
    setCodes(new Set());
    setCreating(false);
    await refresh();
  };

  /**
   * Mints a REPLACEMENT link. The confirmation is not ceremony: the unique
   * index on auth.one_time_tokens means the previous token dies the instant
   * this succeeds, so anyone already holding it is cut off. The owner has to
   * know that before the call, which is why this is the only place in the
   * panel where a read-shaped button asks first.
   */
  const makeLink = async (target: string) => {
    if (
      !window.confirm(
        `Buat tautan masuk baru untuk ${target}?\n\n` +
          'Tautan lama untuk alamat ini LANGSUNG BATAL. Kalau tautan itu sudah ' +
          'dikirim dan belum dipakai, orangnya akan gagal masuk dan perlu ' +
          'dikirimi yang baru.',
      )
    )
      return;
    const result = await call((appKey) =>
      provisionCollaborator(appKey, { action: 'link', email: target }),
    );
    if (!result) return;
    if (result.error || !result.link) {
      setNotice(result.error ?? 'Tidak ada tautan yang dihasilkan.');
      return;
    }
    holdLink(target, result.link, expiryFrom(result.expiresAt));
  };

  /** Re-opens a link already held. Mints nothing, so it is always safe. */
  const showLink = (target: string) => {
    setOpenFor(normalizeVaultEmail(target));
    setRevealed(false);
    setCopied(false);
  };

  const closeLink = () => {
    setOpenFor(null);
    setRevealed(false);
    setCopied(false);
  };

  const revoke = async (target: string) => {
    if (
      !window.confirm(
        `Cabut semua akses ${target} — entitas dan proyek? Riwayat sel dan tugasnya tetap tersimpan.`,
      )
    )
      return;
    const result = await call((appKey) =>
      provisionCollaborator(appKey, { action: 'revoke', email: target }),
    );
    if (!result) return;
    if (result.error) {
      setNotice(result.error);
      return;
    }
    // The grants are gone, so any link we still hold opens nothing. Dropping
    // it is the one case where discarding a link loses nothing. A DEAD OWNER
    // SESSION is deliberately NOT such a case: clearing there would recreate
    // the original bug at the worst moment, forcing a re-mint that cuts off
    // whoever is holding the current link.
    forgetCollabLink(target);
    setVault(recallAllCollabLinks());
    if (openFor === normalizeVaultEmail(target)) closeLink();
    await refresh();
  };

  const openGrantPicker = (userId: string) => {
    setGrantingFor((current) => (current === userId ? null : userId));
    setPendingProjects(new Set());
  };

  const togglePendingProject = (projectId: string) =>
    setPendingProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  const grantProjects = async (target: string) => {
    if (pendingProjects.size === 0) return;
    const result = await call((appKey) =>
      provisionCollaborator(appKey, {
        action: 'grant-projects',
        email: target,
        projectIds: [...pendingProjects],
      }),
    );
    if (!result) return;
    if (result.error) {
      setNotice(result.error);
      return;
    }
    setGrantingFor(null);
    setPendingProjects(new Set());
    await refresh();
  };

  const revokeProject = async (target: string, projectId: string) => {
    const result = await call((appKey) =>
      provisionCollaborator(appKey, { action: 'revoke-project', email: target, projectId }),
    );
    if (!result) return;
    if (result.error) {
      setNotice(result.error);
      return;
    }
    await refresh();
  };

  const toggleCode = (code: string) =>
    setCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const titleFor = (projectId: string) =>
    workProjects.find((project) => project.id === projectId)?.title ??
    `proyek ${projectId.slice(0, 8)}`;

  const openEntry: StoredCollabLink | null = openFor ? (vault[openFor] ?? null) : null;

  const copyLink = async () => {
    if (!openEntry) return;
    try {
      // The REAL url, whether or not it is on screen. Copying must never
      // require revealing — that is the entire point of the masked default.
      await navigator.clipboard.writeText(openEntry.url);
      setCopied(true);
    } catch {
      setNotice('Tidak bisa menyalin otomatis — buka tautannya lalu salin manual.');
    }
  };

  const openStatus = useMemo(() => {
    if (!openEntry) return null;
    const user = users?.find(
      (candidate) => normalizeVaultEmail(candidate.email) === openEntry.email,
    );
    return collabLinkStatus(openEntry, user?.lastSignInAt ?? null, now);
  }, [openEntry, users, now]);

  return (
    <Card className="mt-5">
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="surface-label">Kolaborator</p>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              Akses diberikan dari sini, bukan lewat email: buat akun, pilih entitas, salin
              tautannya, kirim sendiri lewat WhatsApp. Aplikasi tidak pernah mengirim apa pun.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCreating((current) => !current)}
            disabled={busy || sessionDead}
          >
            <UserPlus className="size-4" />
            {creating ? 'Batal' : 'Tambah kolaborator'}
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

        {creating && (
          <div className="mt-3 rounded-md border border-border bg-surface-2/50 p-3">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email@kantor"
              aria-label="Email kolaborator baru"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entities.map((entity) => (
                <button
                  key={entity.code}
                  type="button"
                  onClick={() => toggleCode(entity.code)}
                  aria-pressed={codes.has(entity.code)}
                  className={cn(
                    'min-h-8 rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    codes.has(entity.code)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-foreground-muted hover:text-foreground-secondary',
                  )}
                >
                  {entity.code}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => void create()}
              disabled={busy || !email.trim() || codes.size === 0}
            >
              Buat + hasilkan tautan
            </Button>
          </div>
        )}

        {/* THE MASKED LINK PANEL. Closed by a press, never by a timer, and
            masked until asked otherwise — this card gets screenshotted. The
            destination stays legible while the secret does not, so "is this
            pointing at my own site?" costs nothing to check. */}
        {openEntry && (
          <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 break-words text-[11px] font-semibold text-foreground">
                Tautan masuk untuk {openEntry.email}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={closeLink}
                aria-label="Tutup panel tautan"
              >
                <X className="size-3.5" />
                Tutup
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Input
                readOnly
                className="min-w-0 flex-1"
                value={revealed ? openEntry.url : maskCollabLink(openEntry.url)}
                aria-label={
                  revealed
                    ? 'Tautan masuk kolaborator, sedang ditampilkan'
                    : 'Tautan masuk kolaborator, tersembunyi — pakai tombol Salin atau Lihat'
                }
              />
              {/* Copy is the heaviest control here: it is the reason the panel
                  is open. Reveal steps down to ghost — it is an escape hatch
                  for manual copying, not the main path. */}
              <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
                <Copy className="size-4" />
                {copied ? 'Tersalin' : 'Salin'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRevealed((current) => !current)}
                aria-pressed={revealed}
              >
                {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {revealed ? 'Sembunyikan' : 'Lihat'}
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 tabular-nums text-foreground-muted">
              {openStatus && openStatus.kind !== 'none'
                ? `${describeCollabLink(openStatus)} · `
                : ''}
              Sekali pakai. Membuat tautan baru untuk alamat ini membatalkan yang ini.
            </p>
          </div>
        )}

        <div className="mt-3 border-t border-border-subtle pt-3">
          {users === null ? (
            <p className="text-[11px] text-foreground-muted">
              {sessionDead ? 'Daftar tidak dimuat — sesi terkunci.' : 'Memuat daftar…'}
            </p>
          ) : users.length === 0 ? (
            <p className="text-[11px] text-foreground-muted">Belum ada kolaborator.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {users.map((user) => {
                const grantedIds = new Set(user.projectIds);
                const grantable = workProjects.filter(
                  (project) => !grantedIds.has(project.id),
                );
                // TWO DIFFERENT QUESTIONS, and conflating them was a bug. The
                // server refuses to mint for a user with no ENTITY membership
                // (a link into zero entities signs them straight back out), so
                // the link gate must ask exactly that. Revoke, meanwhile, has
                // something to do whenever EITHER axis holds a grant.
                const canLink = user.entityCodes.length > 0;
                const canRevoke = user.entityCodes.length > 0 || user.projectIds.length > 0;
                const pickerOpen = grantingFor === user.userId;
                const held = vault[normalizeVaultEmail(user.email)] ?? null;
                const status = collabLinkStatus(held, user.lastSignInAt, now);
                const statusLine = describeCollabLink(status);
                return (
                  <li key={user.userId} className="py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1 break-words text-[11px] font-medium text-foreground">
                        {user.email}
                      </span>
                      <span className="text-[10px] tabular-nums text-foreground-muted">
                        {user.lastSignInAt
                          ? `masuk ${user.lastSignInAt.slice(0, 16).replace('T', ' ')}`
                          : 'belum pernah masuk'}
                      </span>
                      {/* Only rendered when a link is actually held, so its
                          presence is itself the signal that one can be
                          recovered without minting. */}
                      {status.kind === 'live' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => showLink(user.email)}
                          title="Buka lagi tautan yang sudah dibuat — tidak membuat yang baru"
                        >
                          <Link2 className="size-3.5" />
                          Lihat tautan
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void makeLink(user.email)}
                        disabled={busy || sessionDead || !canLink}
                        title={
                          canLink
                            ? 'Buat tautan masuk baru — tautan lama untuk alamat ini langsung batal'
                            : 'Tanpa entitas — tautan tidak akan membuka apa pun'
                        }
                      >
                        <RefreshCw className="size-3.5" />
                        Tautan baru
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void revoke(user.email)}
                        disabled={busy || sessionDead || !canRevoke}
                        title={
                          canRevoke
                            ? 'Hapus keanggotaan entitas DAN proyek; akun dan riwayatnya tetap'
                            : 'Tidak ada akses yang bisa dicabut'
                        }
                      >
                        <UserX className="size-3.5" />
                        Cabut
                      </Button>
                    </div>
                    {statusLine && (
                      <p className="mt-1 text-[10px] leading-4 tabular-nums text-foreground-secondary">
                        {statusLine}
                      </p>
                    )}
                    {/* The dimmed row, explained in the open rather than in a
                        tooltip. A disabled control whose reason is invisible
                        reads as broken software. */}
                    {!canLink && (
                      <p className="mt-1 text-[10px] leading-4 text-foreground-muted">
                        Tanpa entitas, tautan masuk tidak dibuat: sesi tanpa keanggotaan
                        langsung dikeluarkan lagi. Beri entitas dulu.
                      </p>
                    )}
                    {/* Two grant sets, labelled apart: entity access is the
                        Finish line column, project access is tasks. One chip
                        row each, so they can never be read as one thing. */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                        Entitas
                      </span>
                      {user.entityCodes.length > 0 ? (
                        user.entityCodes.map((code) => (
                          <span
                            key={code}
                            className="rounded-sm border border-border px-1.5 py-0.5 font-semibold uppercase tracking-[0.08em] text-foreground-secondary"
                          >
                            {code}
                          </span>
                        ))
                      ) : (
                        <span className="text-foreground-muted">tidak ada</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="font-semibold uppercase tracking-[0.08em] text-foreground-muted">
                        Proyek
                      </span>
                      {user.projectIds.length === 0 && (
                        <span className="text-foreground-muted">tidak ada</span>
                      )}
                      {user.projectIds.map((projectId) => (
                        <span
                          key={projectId}
                          className="inline-flex items-center gap-1 rounded-sm border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-foreground-secondary"
                        >
                          {titleFor(projectId)}
                          <button
                            type="button"
                            onClick={() => void revokeProject(user.email, projectId)}
                            disabled={busy || sessionDead}
                            aria-label={`Cabut akses ${user.email} ke ${titleFor(projectId)}`}
                            className="text-foreground-muted transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                      {grantable.length > 0 && (
                        <button
                          type="button"
                          onClick={() => openGrantPicker(user.userId)}
                          disabled={busy || sessionDead}
                          aria-expanded={pickerOpen}
                          className="rounded-sm border border-dashed border-border px-1.5 py-0.5 text-foreground-muted transition-colors hover:text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {pickerOpen ? 'tutup' : '+ beri akses proyek'}
                        </button>
                      )}
                    </div>
                    {pickerOpen && (
                      <div className="mt-2 rounded-md border border-border bg-surface-2/50 p-2.5">
                        {/* Same chip multi-select as the entity axis: pick
                            several, one submit. Groups by engagement so
                            internal projects are never a mis-click away —
                            the grouping informs; the WORK-only rule is
                            enforced in SQL either way. */}
                        {ENGAGEMENT_GROUPS.map(({ engagement, label, caution }) => {
                          const group = grantable.filter(
                            (project) => project.engagement === engagement,
                          );
                          if (group.length === 0) return null;
                          return (
                            <div key={engagement} className="mb-2 last:mb-0">
                              <p
                                className={cn(
                                  'mb-1 text-[9px] font-bold uppercase tracking-[0.12em]',
                                  caution ? 'text-destructive' : 'text-foreground-muted',
                                )}
                              >
                                {label}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {group.map((project) => (
                                  <button
                                    key={project.id}
                                    type="button"
                                    onClick={() => togglePendingProject(project.id)}
                                    aria-pressed={pendingProjects.has(project.id)}
                                    className={cn(
                                      'min-h-8 rounded-sm border px-2 py-1 text-[10px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                      pendingProjects.has(project.id)
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border text-foreground-muted hover:text-foreground-secondary',
                                    )}
                                  >
                                    {project.title}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() => void grantProjects(user.email)}
                          disabled={busy || sessionDead || pendingProjects.size === 0}
                        >
                          <Check className="size-3.5" />
                          Berikan akses ({pendingProjects.size})
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

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

/**
 * The server's authoritative expiry, when it sends one. It is an ISO string
 * on the wire; anything unparseable falls back to the client's own default so
 * the panel is correct with or without an Edge Function redeploy.
 */
function expiryFrom(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
