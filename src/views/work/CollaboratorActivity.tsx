import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, KeyRound, ListChecks, PenLine, Table2 } from 'lucide-react';
import {
  buildCellLabels,
  buildCollaboratorActivity,
  buildProcessRowLabels,
  buildTaskLabels,
  countUnattributedTextEdits,
  type ActivityEvent,
  type ActivityKind,
} from '../../logic/collaboratorActivity';
import { rowsOf } from '../../data/readResult';
import type { Repository } from '../../data/repository';
import type { ProcessTextHistoryEntry } from '../../data/types';

/**
 * ONE COLLABORATOR'S TRAIL, on demand.
 *
 * ===========================================================================
 * WHY THIS IS A DISCLOSURE AND NOT A COLUMN.
 * ===========================================================================
 * The Kolaborator card already carries the thing that must not be missed —
 * access: who holds which entities, which link is live, what "Tautan baru"
 * destroys. A trail rendered inline beside that would compete with it, and the
 * access controls would lose, because a list is visually heavier than a row of
 * buttons. So the trail opens on a deliberate press, one person at a time, and
 * the closed state costs one tertiary control per row.
 *
 * It also means the twelve reads below happen for the person actually being
 * asked about, rather than for four people on every mount.
 *
 * ===========================================================================
 * THE READS ARE TWO-PHASE, AND THE SECOND PHASE IS USUALLY SKIPPED.
 * ===========================================================================
 * Phase one is the four audit sources. Phase two is the LABELS — cells, items,
 * tasks and the five process tables — and only the ones a source actually
 * produced rows for are fetched. Somebody who has signed in and touched
 * nothing costs four reads, not twelve, and today that is everybody.
 *
 * ===========================================================================
 * A MISSING TABLE RENDERS AS NOTHING. A BROKEN READ DOES NOT.
 * ===========================================================================
 * os_sign_in_log does not exist until migration 20260809000070 is applied, and
 * this ships first. That read answers 42P01, the repository classifies it as
 * missing-relation, and the sign-in lines are simply absent — no error card,
 * no empty-state copy about a table, and nothing on the console. The rest of
 * the trail still renders, because the other three tables are there.
 *
 * What does NOT happen is the same treatment for a failure. A permission
 * error, a network failure, or a query naming a column that is not there
 * (42703) is a different fact and reaches the surface as one visible line. The
 * two conditions are classified apart in data/missingRelation.ts and must stay
 * apart: an audit trail that renders "no activity" because a read broke says
 * nobody did anything, which is the most expensive sentence this app can print.
 */

const KIND_META: Record<ActivityKind, { label: string; Icon: typeof KeyRound }> = {
  'sign-in': { label: 'Masuk', Icon: KeyRound },
  cell: { label: 'Sel', Icon: Table2 },
  task: { label: 'Task', Icon: ListChecks },
  text: { label: 'Teks', Icon: PenLine },
};

/** `2026-08-07T04:17:27Z` → `07-08 04:17`, local, tabular. */
function stamp(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return at.slice(0, 16).replace('T', ' ');
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(when.getDate())}-${pad(when.getMonth() + 1)} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

interface TrailState {
  events: ActivityEvent[];
  /** Rows nobody can be named for — pre-migration-69 text edits. */
  unattributed: number;
  /** A read genuinely failed. Absent tables are NOT this. */
  failure: string | null;
}

async function loadTrail(repository: Repository, userId: string): Promise<TrailState> {
  const [signIns, cellHistory, taskHistory, textHistory] = await Promise.all([
    repository.listSignInLog(),
    repository.listCellHistory(),
    repository.listTaskHistory(),
    repository.listProcessTextHistory(),
  ]);

  // 'failed' surfaces; 'missing-relation' is the expected pre-migration state
  // and folds to no rows from that source.
  const failure = [signIns, cellHistory, taskHistory, textHistory].find(
    (result) => !result.ok && result.reason === 'failed',
  );

  const mine = {
    signIns: rowsOf(signIns).filter((row) => row.userId === userId),
    cellHistory: rowsOf(cellHistory).filter((row) => row.actor === userId),
    taskHistory: rowsOf(taskHistory).filter((row) => row.actor === userId),
    textHistory: rowsOf(textHistory).filter((row) => row.actor === userId),
  };

  // Phase two, narrowed to the sources that produced something.
  const [cells, items] =
    mine.cellHistory.length > 0
      ? await Promise.all([repository.listFinishLineCells(), repository.listFinishLineItems()])
      : [null, null];
  const tasks = mine.taskHistory.length > 0 ? await repository.listProjectTasks() : null;
  const [steps, needs, gates, lanes, phases] =
    mine.textHistory.length > 0
      ? await Promise.all([
          repository.listProcessSteps(),
          repository.listProcessNeeds(),
          repository.listProcessGates(),
          repository.listProcessLanes(),
          repository.listProcessPhases(),
        ])
      : [null, null, null, null, null];

  const events = buildCollaboratorActivity(userId, mine, {
    cells: cells && items ? buildCellLabels(rowsOf(cells), rowsOf(items)) : new Map(),
    tasks: tasks ? buildTaskLabels(rowsOf(tasks)) : new Map(),
    processRows:
      steps && needs && gates && lanes && phases
        ? buildProcessRowLabels({
            steps: rowsOf(steps),
            needs: rowsOf(needs),
            gates: rowsOf(gates),
            lanes: rowsOf(lanes),
            phases: rowsOf(phases),
          })
        : new Map(),
  });

  return {
    events,
    unattributed: countUnattributedTextEdits(
      rowsOf(textHistory) as ProcessTextHistoryEntry[],
    ),
    failure: failure && !failure.ok ? failure.detail : null,
  };
}

export function CollaboratorActivity({
  repository,
  userId,
  email,
}: {
  repository: Repository;
  userId: string;
  email: string;
}) {
  const [state, setState] = useState<TrailState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await loadTrail(repository, userId));
    } catch (error) {
      // Never console. The detail is rendered where the person looking at the
      // screen can act on it, and it carries no link, token, or credential.
      setState({
        events: [],
        unattributed: 0,
        failure: error instanceof Error ? error.message : 'Pembacaan jejak gagal.',
      });
    } finally {
      setLoading(false);
    }
  }, [repository, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="mt-2 text-[10px] leading-4 text-foreground-muted">Memuat jejak…</p>
    );
  }
  if (!state) return null;

  return (
    <div className="mt-2 rounded-md border border-border bg-surface-2/50 p-2.5">
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-foreground-muted">
        Jejak aktivitas — {email}
      </p>

      {state.failure && (
        // A read that BROKE. Distinct from an absent table by construction, and
        // it says so rather than rendering as "nothing happened".
        <p className="mt-1.5 text-[10px] leading-4 text-destructive">
          Sebagian jejak tidak terbaca, jadi daftar ini belum tentu lengkap: {state.failure}
        </p>
      )}

      {state.events.length === 0 ? (
        // Sized to a couple of rows, not to the container. An empty trail is a
        // fact worth one sentence, and it is a common one — three of the four
        // accounts have never changed anything.
        <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">
          Belum ada aktivitas tercatat. Yang dicatat hanya perubahan pada sel, task, teks
          proses, dan waktu masuk.
        </p>
      ) : (
        <ul className="mt-1.5 divide-y divide-border-subtle">
          {state.events.map((event) => {
            const { label, Icon } = KIND_META[event.kind];
            return (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
                <span className="w-[4.5rem] shrink-0 text-[10px] tabular-nums text-foreground-muted">
                  {stamp(event.at)}
                </span>
                {/* The kind is carried by the WORD, with the icon as a second
                    channel. Never by colour alone — these four have to be
                    told apart at 10px by everyone. */}
                <span className="inline-flex w-[3.5rem] shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary">
                  <Icon className="size-3" aria-hidden />
                  {label}
                </span>
                {/* A sign-in has no object, so it contributes no subject and
                    the row is just time + kind. The spacer keeps the detail
                    column aligned down the list either way. */}
                <span className="min-w-0 flex-1 break-words text-[10px] leading-4 text-foreground">
                  {event.subject}
                  {event.unresolved && (
                    // The row_id could not be translated. It is shown raw and
                    // named as raw — never dropped, because an audit list that
                    // hides what it cannot pretty-print is worse than an ugly
                    // one.
                    <span className="ml-1 text-foreground-muted">(rujukan mentah)</span>
                  )}
                </span>
                {event.detail && (
                  <span className="inline-flex items-center gap-1 text-[10px] leading-4 text-foreground-secondary">
                    <ArrowRight className="size-3 shrink-0" aria-hidden />
                    {event.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {state.unattributed > 0 && (
        <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">
          {state.unattributed} perubahan teks proses tercatat tanpa aktor (ditulis sebelum
          migration 69) — tidak bisa dikaitkan ke siapa pun, jadi tidak masuk daftar ini.
        </p>
      )}
    </div>
  );
}
