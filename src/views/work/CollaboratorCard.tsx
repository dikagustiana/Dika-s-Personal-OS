import { Copy, RefreshCw, UserPlus, UserX, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { readStoredKey } from '../../components/PassphraseGate';
import {
  provisionCollaborator,
  type ProvisionedUser,
} from '../../data/supabaseRepository';
import type { FinishLineEntity, Project, ProjectMember } from '../../data/types';
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
 * Every call goes to the provision-collaborator Edge Function, which verifies
 * the owner passphrase server-side (same bcrypt + lockout as the gate) before
 * touching anything, and appends each action to private.os_provision_log.
 * This panel is rendered only inside the owner session, but that is
 * cosmetic — the function's own check is the boundary.
 *
 * TWO INDEPENDENT GRANT SETS PER PERSON, labelled apart on purpose (slice 1):
 * ENTITAS opens Finish line columns, PROYEK opens a project's tasks. Neither
 * implies the other — the axes are separate tables behind separate policies.
 * Entity grants ride the Edge Function (they are minted with the account);
 * project grants are plain owner writes on os_project_members through the
 * repository, because the user already exists.
 *
 * Revoke removes MEMBERSHIP ON BOTH AXES, not the auth user: history rows
 * keep their actor, and a membershipless session reads nothing from its next
 * query on.
 */
export function CollaboratorCard({ entities }: { entities: FinishLineEntity[] }) {
  const repository = useAppStore((state) => state.repository);
  const [users, setUsers] = useState<ProvisionedUser[] | null>(null);
  const [workProjects, setWorkProjects] = useState<Project[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [codes, setCodes] = useState<Set<string>>(new Set());
  // The freshly minted link, per email — shown once with a copy button, like
  // the share-link card: what leaves this panel is the owner's to carry.
  const [link, setLink] = useState<{ email: string; url: string; expiry: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const call = useCallback(
    async <T,>(fn: (appKey: string) => Promise<T>): Promise<T | undefined> => {
      const appKey = readStoredKey();
      if (!appKey) {
        setNotice('Sesi terkunci — buka ulang dengan passphrase dulu.');
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
    const result = await call((appKey) => provisionCollaborator(appKey, { action: 'list' }));
    if (!result) return;
    if (result.error) setNotice(result.error);
    else setUsers(result.users ?? []);
    // The project axis, straight from the repository (owner path). Failure
    // leaves the chips empty rather than taking the whole panel down.
    try {
      const [memberRows, projects] = await Promise.all([
        repository.listProjectMembers(),
        repository.listProjects('work'),
      ]);
      setProjectMembers(memberRows.ok ? memberRows.rows : []);
      setWorkProjects(projects.filter((project) => project.recurring !== 'monthly'));
    } catch {
      setProjectMembers([]);
    }
  }, [call, repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grantsFor = useCallback(
    (userId: string) => projectMembers.filter((member) => member.userId === userId),
    [projectMembers],
  );

  const grantProject = async (userId: string, projectId: string) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await repository.grantProjectMembership(userId, projectId);
      const rows = await repository.listProjectMembers();
      setProjectMembers(rows.ok ? rows.rows : []);
    } catch {
      setNotice('Gagal memberi akses proyek.');
    } finally {
      setBusy(false);
    }
  };

  const revokeProject = async (userId: string, projectId: string) => {
    setBusy(true);
    try {
      await repository.revokeProjectMembership(userId, projectId);
      setProjectMembers((current) =>
        current.filter(
          (member) => !(member.userId === userId && member.projectId === projectId),
        ),
      );
    } catch {
      setNotice('Gagal mencabut akses proyek.');
    } finally {
      setBusy(false);
    }
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

  const revoke = async (target: string, userId: string) => {
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
    if (result.error) setNotice(result.error);
    // The Edge Function clears the ENTITY axis; the project axis is cleared
    // here, grant by grant, through the same owner-key policies. Leaving it
    // would leave a "revoked" account still reading its granted projects.
    for (const member of grantsFor(userId)) {
      try {
        await repository.revokeProjectMembership(userId, member.projectId);
      } catch {
        setNotice('Sebagian akses proyek gagal dicabut — coba lagi.');
      }
    }
    if (link?.email === target) setLink(null);
    await refresh();
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setNotice('Salin manual dari kolom di bawah.');
    }
  };

  const toggleCode = (code: string) =>
    setCodes((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

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
            disabled={busy}
          >
            <UserPlus className="size-4" />
            {creating ? 'Batal' : 'Tambah kolaborator'}
          </Button>
        </div>

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
            <p className="text-[11px] text-foreground-muted">Memuat daftar…</p>
          ) : users.length === 0 ? (
            <p className="text-[11px] text-foreground-muted">Belum ada kolaborator.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {users.map((user) => {
                const grants = grantsFor(user.userId);
                const grantedIds = new Set(grants.map((member) => member.projectId));
                const grantable = workProjects.filter(
                  (project) => !grantedIds.has(project.id),
                );
                const titleFor = (projectId: string) =>
                  workProjects.find((project) => project.id === projectId)?.title ??
                  `proyek ${projectId.slice(0, 8)}`;
                const hasAccess = user.entityCodes.length > 0 || grants.length > 0;
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
                        disabled={busy || !hasAccess}
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
                        onClick={() => void revoke(user.email, user.userId)}
                        disabled={busy || !hasAccess}
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
                      {grants.length === 0 && (
                        <span className="text-foreground-muted">tidak ada</span>
                      )}
                      {grants.map((member) => (
                        <span
                          key={member.projectId}
                          className="inline-flex items-center gap-1 rounded-sm border border-primary/40 bg-primary/5 px-1.5 py-0.5 text-foreground-secondary"
                        >
                          {titleFor(member.projectId)}
                          <button
                            type="button"
                            onClick={() => void revokeProject(user.userId, member.projectId)}
                            disabled={busy}
                            aria-label={`Cabut akses ${user.email} ke ${titleFor(member.projectId)}`}
                            className="text-foreground-muted transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                      {grantable.length > 0 && (
                        <select
                          className="native-select !h-7 !w-auto text-[10px]"
                          value=""
                          disabled={busy}
                          onChange={(event) =>
                            void grantProject(user.userId, event.target.value)
                          }
                          aria-label={`Beri ${user.email} akses proyek`}
                        >
                          <option value="">+ beri akses proyek</option>
                          {grantable.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.title}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
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
