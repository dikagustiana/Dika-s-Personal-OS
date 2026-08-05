import { Check, Copy, Lock, RefreshCw, UserPlus, UserX, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { lockApp, readStoredKey } from '../../components/PassphraseGate';
import {
  provisionCollaborator,
  type ProvisionedUser,
} from '../../data/supabaseRepository';
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
  // The freshly minted link, per email — shown once with a copy button, like
  // the share-link card: what leaves this panel is the owner's to carry.
  const [link, setLink] = useState<{ email: string; url: string; expiry: string } | null>(null);
  const [copied, setCopied] = useState(false);

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
    setLink({ email: result.email ?? trimmed, url: result.link, expiry: result.expiry ?? '' });
    setCopied(false);
    setEmail('');
    setCodes(new Set());
    setCreating(false);
    await refresh();
  };

  const makeLink = async (target: string) => {
    const result = await call((appKey) =>
      provisionCollaborator(appKey, { action: 'link', email: target }),
    );
    if (!result) return;
    if (result.error || !result.link) {
      setNotice(result.error ?? 'Tidak ada tautan yang dihasilkan.');
      return;
    }
    setLink({ email: target, url: result.link, expiry: result.expiry ?? '' });
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
    if (link?.email === target) setLink(null);
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

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setNotice('Salin manual dari kolom di bawah.');
    }
  };

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

        {link && (
          <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-[11px] font-semibold text-foreground">
              Tautan masuk untuk {link.email}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <Input readOnly value={link.url} aria-label="Tautan masuk kolaborator" />
              <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
                <Copy className="size-4" />
                {copied ? 'Tersalin' : 'Salin'}
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">{link.expiry}</p>
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
                const hasAccess = user.entityCodes.length > 0 || user.projectIds.length > 0;
                const pickerOpen = grantingFor === user.userId;
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void makeLink(user.email)}
                        disabled={busy || sessionDead || !hasAccess}
                        title={
                          hasAccess
                            ? 'Hasilkan tautan masuk baru'
                            : 'Tanpa akses — beri entitas atau proyek dulu'
                        }
                      >
                        <RefreshCw className="size-3.5" />
                        Tautan baru
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void revoke(user.email)}
                        disabled={busy || sessionDead || !hasAccess}
                        title="Hapus keanggotaan entitas DAN proyek; akun dan riwayatnya tetap"
                      >
                        <UserX className="size-3.5" />
                        Cabut
                      </Button>
                    </div>
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
