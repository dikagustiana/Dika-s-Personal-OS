import { useMemo, useState } from 'react';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import type { ReadResult } from '../../data/readResult';
import type {
  FinishLineAccount,
  FinishLineAccountMapRow,
  FinishLineAccountWrite,
  FinishLineCell,
  FinishLineItem,
} from '../../data/types';
import { cn } from '../../lib/utils';
import {
  buildAccountPasteDiff,
  parseAccountPaste,
  replaceRefusalReason,
  type AccountPasteDiff,
} from '../../logic/finishLineAccountPaste';

/**
 * PASTE TO UPDATE THE ACCOUNT LEVEL — the one write path.
 *
 * The workbook stays authoritative: nothing here is editable inline, and this
 * card only accepts rows copied straight out of the consolidation sheet. The
 * shape mirrors the IELTS error log because that path is the one paste flow
 * in this app that actually gets used: paste, parse tolerantly, PREVIEW,
 * commit. Nothing writes until the preview has said what will happen.
 *
 * TWO MODES WITH DIFFERENT RISK. Upsert is the default and cannot delete —
 * the diff cannot even express a deletion in upsert mode. Replace-all is a
 * separate, differently-labelled action, confirms with the exact delete
 * count, and refuses a paste under 100 rows: a partial paste in replace mode
 * would silently delete hundreds of accounts, and the likeliest trigger is
 * picking the wrong mode by accident.
 *
 * THE PREVIEW NAMES EVERY METRIC MOVE. An account whose function or business
 * changes bucket moves cell, which moves two coverage figures and two gap
 * counts — the highest-consequence edit here, and invisible in a plain
 * updated-count. Old metric and new, by name, before anything commits.
 */
export function AccountPasteCard({
  accounts,
  accountsKnown,
  mapResult,
  cells,
  items,
  isPending,
  onCommit,
}: {
  accounts: FinishLineAccount[];
  /** False while the accounts read has not landed — commit stays closed. */
  accountsKnown: boolean;
  /**
   * The mapping read. A commit without it would resolve every pasted row to
   * "unmapped" and quietly strip cells — so no map, no commit.
   */
  mapResult: ReadResult<FinishLineAccountMapRow>;
  cells: FinishLineCell[];
  items: FinishLineItem[];
  isPending: boolean;
  /** Runs the repository write; resolves false when the mutation failed. */
  onCommit: (input: {
    upserts: FinishLineAccountWrite[];
    deleteIds: string[];
  }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'upsert' | 'replace'>('upsert');
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  /** The last commit's one-line outcome. Stays until the next paste. */
  const [lastOutcome, setLastOutcome] = useState<string | undefined>(undefined);

  const parsed = useMemo(() => parseAccountPaste(text), [text]);

  const diff: AccountPasteDiff | undefined = useMemo(() => {
    if (parsed.rows.length === 0 || !mapResult.ok || !accountsKnown) return undefined;
    return buildAccountPasteDiff({
      parsed: parsed.rows,
      existing: accounts,
      map: mapResult.rows,
      cells,
      items,
      mode,
    });
  }, [parsed.rows, accounts, accountsKnown, mapResult, cells, items, mode]);

  const replaceRefusal = mode === 'replace' ? replaceRefusalReason(parsed.rows.length) : undefined;

  const summaryLine = (d: AccountPasteDiff) =>
    `${d.updated.length} diperbarui · ${d.added.length} baru · ${d.deleted.length} dihapus`;

  /**
   * The commit RE-DERIVES its diff for the mode it was asked to run, rather
   * than trusting the rendered one: a stale replace diff committed after
   * switching back to upsert would carry deletions into a mode that promises
   * never to delete.
   */
  const commitWith = async (commitMode: 'upsert' | 'replace') => {
    if (!mapResult.ok || !accountsKnown || parsed.rows.length === 0) return;
    if (commitMode === 'replace' && replaceRefusalReason(parsed.rows.length)) return;
    const d = buildAccountPasteDiff({
      parsed: parsed.rows,
      existing: accounts,
      map: mapResult.rows,
      cells,
      items,
      mode: commitMode,
    });
    if (d.updated.length + d.added.length + d.deleted.length === 0) return;
    const ok = await onCommit({
      upserts: [...d.updated, ...d.added],
      deleteIds: d.deleted.map((del) => del.id),
    });
    if (!ok) return; // paste stays on screen, safe to retry
    setLastOutcome(summaryLine(d));
    setText('');
    setMode('upsert');
    setConfirmingReplace(false);
  };

  const canCommitUpsert =
    diff !== undefined && !isPending && diff.updated.length + diff.added.length > 0;

  return (
    <Card className="mt-5">
      <CardContent className="pt-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-foreground-muted transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              Update account detail
            </span>
            <span className="block text-xs text-foreground-muted">
              Paste baris dari sheet konsolidasi — pratinjau dulu, baru commit. Workbook tetap
              sumber kebenaran.
            </span>
          </span>
          {lastOutcome && !open && (
            <span className="shrink-0 text-xs tabular-nums text-foreground-secondary">
              {lastOutcome}
            </span>
          )}
        </button>

        {open && (
          <div className="mt-3 space-y-3">
            {/* No map, no commit: without the mapping every row would resolve
                to unmapped and a commit would quietly strip cells. */}
            {!mapResult.ok && (
              <p className="flex items-start gap-2 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                The account mapping could not be read, so a paste cannot resolve which cell each
                row belongs to. Committing is closed. {mapResult.detail}
              </p>
            )}

            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setLastOutcome(undefined);
                setConfirmingReplace(false);
              }}
              rows={6}
              spellCheck={false}
              placeholder="Salin baris dari sheet, lalu paste di sini — header ikut pun tidak apa-apa."
              className="w-full rounded-sm border border-border bg-surface-2 p-2 font-mono text-[11px] leading-4 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            {text.trim() !== '' && (
              <div className="space-y-2 text-xs">
                {parsed.discardedHeaders > 0 && (
                  <p className="text-foreground-muted">
                    {parsed.discardedHeaders} baris header dibuang.
                  </p>
                )}

                {/* Rejected rows: visible, per-row, never sinking the rest. */}
                {parsed.rejected.length > 0 && (
                  <div className="rounded-sm border border-escalate bg-escalate/10 px-2.5 py-2">
                    <p className="font-semibold text-escalate">
                      {parsed.rejected.length} baris dilewati
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-foreground-secondary">
                      {parsed.rejected.slice(0, 5).map((r) => (
                        <li key={r.line}>
                          Baris {r.line}: {r.reason}
                        </li>
                      ))}
                      {parsed.rejected.length > 5 && (
                        <li>+ {parsed.rejected.length - 5} lagi</li>
                      )}
                    </ul>
                  </div>
                )}

                {diff && (
                  <div className="rounded-sm border border-border-subtle bg-surface-2 px-2.5 py-2">
                    <p className="font-semibold tabular-nums text-foreground">
                      {summaryLine(diff)}
                    </p>
                    {diff.unchanged > 0 && (
                      <p className="mt-0.5 text-[11px] text-foreground-muted">
                        {diff.unchanged} identik — tidak disentuh.
                      </p>
                    )}
                    {diff.quietChanges > 0 && (
                      <p className="mt-0.5 text-[11px] text-foreground-muted">
                        {diff.quietChanges} hanya fakta workbook berubah — sel tetap.
                      </p>
                    )}

                    {/* THE LINE THAT MATTERS: every account changing metric,
                        old and new by name, before anything commits. */}
                    {diff.metricMoves.length > 0 && (
                      <div className="mt-2 border-t border-border-subtle pt-2">
                        <p className="font-semibold text-escalate">
                          {diff.metricMoves.length} akun pindah metrik — dua angka coverage ikut
                          bergeser:
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {diff.metricMoves.map((m) => (
                            <li
                              key={`${m.accountName}-${m.toMetric}`}
                              className="flex flex-wrap items-baseline gap-x-2 text-[11px]"
                            >
                              <span className="font-medium text-foreground">{m.accountName}</span>
                              <span className="text-foreground-muted">
                                {m.fromMetric} → {m.toMetric}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {diff.unmappedLandings.length > 0 && (
                      <p className="mt-2 text-[11px] text-foreground-secondary">
                        {diff.unmappedLandings.length} baris tidak terpetakan ke metrik mana pun —
                        tetap disimpan dan muncul di daftar unmapped, tidak dibuang.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {/* Upsert: the default, cannot delete. */}
                  <Button
                    onClick={() => {
                      setMode('upsert');
                      setConfirmingReplace(false);
                      void commitWith('upsert');
                    }}
                    disabled={!canCommitUpsert && mode === 'upsert'}
                  >
                    {isPending ? 'Menyimpan…' : 'Commit update'}
                  </Button>

                  {/* Replace-all: separate, labelled by consequence, confirmed. */}
                  {!confirmingReplace ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMode('replace');
                        setConfirmingReplace(true);
                      }}
                      disabled={isPending || !mapResult.ok || !accountsKnown}
                    >
                      Ganti semua…
                    </Button>
                  ) : replaceRefusal ? (
                    <p className="text-[11px] font-semibold text-destructive">{replaceRefusal}</p>
                  ) : (
                    diff && (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold text-destructive">
                          Ganti semua akan menghapus {diff.deleted.length} akun yang tidak ada di
                          paste ini.
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void commitWith('replace')}
                          disabled={isPending}
                        >
                          Ya, ganti semua
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setMode('upsert');
                            setConfirmingReplace(false);
                          }}
                        >
                          Batal
                        </Button>
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {lastOutcome && text.trim() === '' && (
              <p className="text-xs font-semibold tabular-nums text-foreground-secondary">
                {lastOutcome}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
