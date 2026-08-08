import { AlertTriangle, Check, Copy, Save } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Input } from '../ui/Input';
import type { IeltsError, IeltsErrorSkill, IeltsSession } from '../../data/types';
import {
  PARSER_EXPECTATION,
  fieldsSignature,
  parseErrorLog,
  partitionAgainstCommitted,
  validateFields,
  type ParsedFields,
} from '../../logic/ielts/parseErrorLog';
import { prIeltsMarking } from '../../logic/ielts/marking';
import {
  IELTS_ERROR_SKILLS,
  IELTS_ERROR_TAXONOMY,
  isIeltsErrorSkill,
} from '../../logic/ielts/taxonomy';
import { useMutation } from '../../hooks/useMutation';
import { useAppStore } from '../../store/appStore';
import { cn } from '../../lib/utils';

/**
 * PASTE THE WHOLE AI RESPONSE.
 *
 * Entering eight errors through a one-at-a-time form is how this feature dies:
 * the timebox has zero uses across the whole app for exactly that reason, and
 * the cause was interaction cost, not the idea. But the box must accept the
 * ENTIRE marking response, unedited — if it only accepted the fenced log, every
 * session would cost three extra steps (copy the reply, hunt for the fence,
 * copy just that, paste), which is the same friction one layer out.
 *
 * So he pastes the whole thing and the parser finds the rows. Everything else
 * in the paste — the examiner review, prose between blocks — is ignored
 * silently, because it is expected to be there and is not an error.
 *
 * COMMITTING A PASTE ALSO WRITES THE SESSION — one os_ielts_sessions row per
 * distinct (date, skill) in the committed rows, carrying the full paste as
 * raw_feedback. Not a second action: the session is a fact about the paste,
 * and a separate "also log the session" button would be skipped exactly as
 * often as it mattered. A paste with ZERO error rows still records a session
 * after a one-tap skill prompt — the clean-session path, and the reason
 * sessions are their own table at all.
 */

interface EditableRow {
  key: string;
  line: number;
  raw: string;
  fields: ParsedFields;
  problems: readonly string[];
}

const pairKey = (date: string, skill: IeltsErrorSkill) => `${date} ${skill}`;

/**
 * COPY ONLY. No send button belongs here.
 *
 * This is the seam where one would be added by analogy with the research
 * pipeline's prompt cards (views/growth/research/PromptsTab.tsx), and the reason
 * not to is recorded in full at the top of logic/ielts/marking.ts: the six
 * classification classes count occurrences per category, so a marker that
 * categorises more loosely turns the error log into noise that reads like data.
 * Read that comment before adding one.
 */
function MarkingPrompt() {
  const [skill, setSkill] = useState<IeltsErrorSkill>('writing_task1');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => prIeltsMarking(skill), [skill]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be denied; the prompt is on screen either way.
      setCopied(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Marking prompt</CardTitle>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            Asks for the examiner review you already use, then an error log in the taxonomy this
            app counts. Paste the model's whole reply below — the parser finds the rows.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent>
        <label className="block">
          <span className="sr-only">Skill to mark</span>
          <select
            className="native-select text-xs sm:min-w-48"
            value={skill}
            onChange={(event) => setSkill(event.target.value as IeltsErrorSkill)}
            aria-label="Skill to mark"
          >
            {IELTS_ERROR_SKILLS.map((key) => (
              <option key={key} value={key}>
                {IELTS_ERROR_TAXONOMY[key].label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="mt-3 rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? 'Hide prompt' : 'Show prompt'} ({prompt.length.toLocaleString()} chars)
        </button>
        {open && (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words border border-border-subtle bg-surface-2 p-3 text-[11px] leading-5 text-foreground-secondary">
            {prompt}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function RowEditor({
  row,
  duplicate,
  onChange,
  onCommitAnyway,
}: {
  row: EditableRow;
  /** Already committed this visit — shown, excluded from the next commit. */
  duplicate: boolean;
  onChange: (fields: ParsedFields) => void;
  /** Lifts the hold for THIS row — a new occurrence from a different piece. */
  onCommitAnyway: () => void;
}) {
  // The skill can be an arbitrary string here: a surfaced row with only the
  // date anchor valid carries whatever the model wrote in field 2.
  const taxonomy = isIeltsErrorSkill(row.fields.skill)
    ? IELTS_ERROR_TAXONOMY[row.fields.skill]
    : undefined;
  const valid = row.problems.length === 0;

  return (
    <div
      className={cn(
        'border-l-2 py-2 pl-3',
        duplicate
          ? 'border-border-subtle opacity-60'
          : valid
            ? 'border-success'
            : 'border-destructive bg-destructive/5',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs tabular-nums text-foreground-muted">line {row.line}</span>
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-wider',
            duplicate ? 'text-foreground-muted' : valid ? 'text-success' : 'text-destructive',
          )}
        >
          {duplicate ? 'Already committed' : valid ? 'Valid' : 'Needs attention'}
        </span>
      </div>

      {/* A row found again after it was committed is SHOWN and held back, not
          silently re-inserted and not silently hidden. Two honest exits: edit
          it (a changed row is new content), or say it IS a genuine second
          occurrence — identical fields from a different piece happen, most
          plausibly with [absent: …] quotes — and lift the hold for this row. */}
      {duplicate && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs leading-5 text-foreground-muted">
            Identical to a row already committed — held back.
          </p>
          <button
            type="button"
            onClick={onCommitAnyway}
            className="rounded-sm text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            New occurrence — commit it anyway
          </button>
        </div>
      )}

      {/* Rejected rows stay EDITABLE IN PLACE. A row is never silently dropped
          and one malformed row never blocks the valid ones. */}
      {!valid && (
        <ul className="mt-1 space-y-0.5">
          {row.problems.map((problem) => (
            <li key={problem} className="flex gap-1.5 text-xs leading-5 text-destructive">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              {problem}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="surface-label">Date</span>
          <Input
            type="date"
            className="mt-1"
            value={row.fields.date}
            onChange={(event) => onChange({ ...row.fields, date: event.target.value })}
            aria-label={`Date, line ${row.line}`}
          />
        </label>
        <label className="block">
          <span className="surface-label">Skill</span>
          <select
            className="native-select mt-1 w-full text-xs"
            value={taxonomy ? row.fields.skill : ''}
            onChange={(event) =>
              onChange({ ...row.fields, skill: event.target.value as IeltsErrorSkill })
            }
            aria-label={`Skill, line ${row.line}`}
          >
            {!taxonomy && <option value="">{row.fields.skill || '— pick one —'}</option>}
            {IELTS_ERROR_SKILLS.map((key) => (
              <option key={key} value={key}>
                {IELTS_ERROR_TAXONOMY[key].label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="surface-label">Criterion</span>
          <select
            className="native-select mt-1 w-full text-xs"
            value={
              // `as readonly string[]` widens the taxonomy's const tuple back
              // to an array. The criterion here came off a pasted line and is
              // an arbitrary string; comparing it against a literal union is
              // the check this control exists to perform.
              (taxonomy?.criteria as readonly string[] | undefined)?.includes(row.fields.criterion)
                ? row.fields.criterion
                : ''
            }
            onChange={(event) => onChange({ ...row.fields, criterion: event.target.value })}
            aria-label={`Criterion, line ${row.line}`}
          >
            <option value="">{row.fields.criterion || '— pick one —'}</option>
            {(taxonomy?.criteria ?? []).map((criterion) => (
              <option key={criterion} value={criterion}>
                {criterion}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="surface-label">Failure mode</span>
          <select
            className="native-select mt-1 w-full text-xs"
            value={
              row.fields.failureMode === 'UNCLASSIFIED' ||
              taxonomy?.modes.some((mode) => mode.mode === row.fields.failureMode)
                ? row.fields.failureMode
                : ''
            }
            onChange={(event) => onChange({ ...row.fields, failureMode: event.target.value })}
            aria-label={`Failure mode, line ${row.line}`}
          >
            <option value="">{row.fields.failureMode || '— pick one —'}</option>
            {(taxonomy?.modes ?? []).map((mode) => (
              <option key={mode.mode} value={mode.mode}>
                {mode.mode}
              </option>
            ))}
            <option value="UNCLASSIFIED">UNCLASSIFIED</option>
          </select>
        </label>
        {/* Only meaningful for the two skills that have question types. */}
        {taxonomy?.usesQuestionType && (
          <label className="block">
            <span className="surface-label">Question type (optional)</span>
            <Input
              className="mt-1"
              value={row.fields.questionType ?? ''}
              placeholder="matching headings, T/F/NG…"
              onChange={(event) =>
                onChange({ ...row.fields, questionType: event.target.value || undefined })
              }
              aria-label={`Question type, line ${row.line}`}
            />
          </label>
        )}
        {/* The quote is EDITABLE, same as every other field: a model that
            paraphrased or mangled the verbatim text would otherwise force a
            re-paste of the whole response to fix one string. */}
        <label className={cn('block', !taxonomy?.usesQuestionType && 'sm:col-span-2')}>
          <span className="surface-label">Quote (verbatim)</span>
          <Input
            className="mt-1"
            value={row.fields.quote}
            placeholder="verbatim, or [absent: what is missing]"
            onChange={(event) => onChange({ ...row.fields, quote: event.target.value })}
            aria-label={`Quote, line ${row.line}`}
          />
        </label>
      </div>

      {row.fields.note && (
        <p className="mt-2 break-words text-xs leading-5 text-foreground-muted">
          {row.fields.note}
        </p>
      )}
    </div>
  );
}

export function ErrorLogPaste({
  onCommitted,
  onSessions,
}: {
  onCommitted: (rows: IeltsError[]) => void;
  onSessions: (rows: IeltsSession[]) => void;
}) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<EditableRow[] | null>(null);
  const [discardedHeaders, setDiscardedHeaders] = useState(0);
  const [committed, setCommitted] = useState<string | null>(null);
  // Session-level, set once beside the commit button — a revision is a
  // property of the session, not of each individual mistake.
  const [rewriteOf, setRewriteOf] = useState('');
  // THE RE-INSERT GUARD. "Find rows" re-parses the whole paste, so after a
  // partial commit the already-committed rows come back valid; without this
  // multiset a second Commit would insert them again. Deliberately NOT reset
  // per paste: fixing a typo in the textarea and re-committing is the exact
  // flow the guard exists for, and a changed text must not disarm it. The
  // rare legitimate collision — identical fields from a DIFFERENT piece —
  // exits through the visible per-row override below.
  const [committedCounts, setCommittedCounts] = useState<ReadonlyMap<string, number>>(new Map());
  // Row keys the owner explicitly released from the hold this preview.
  const [overrides, setOverrides] = useState<ReadonlySet<string>>(new Set());
  // Which (date, skill) pairs already produced a session, and from WHICH
  // paste. Keyed by text so a retry of the same paste never doubles the
  // session, while a second piece of the same skill on the same day (a
  // different paste) still records its own row with its own raw_feedback.
  // A REF, not state: the retry in the failure toast re-runs a captured
  // closure, and a state snapshot in that closure would be stale — the retry
  // would re-create sessions the first attempt already wrote.
  const sessionPairsRef = useRef<Map<string, string>>(new Map());
  // Clean-session path state.
  const [cleanDate, setCleanDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const { run, isPending } = useMutation();
  const repository = useAppStore((state) => state.repository);

  const preview = () => {
    const result = parseErrorLog(text);
    setRows(
      result.rows.map((row, index) => ({
        key: `${row.line}-${index}`,
        line: row.line,
        raw: row.raw,
        fields: row.fields,
        problems: row.problems,
      })),
    );
    setDiscardedHeaders(result.discardedHeaders);
    setCommitted(null);
    setOverrides(new Set());
    // Session-level and PER-PASTE: a rewrite date set for the previous paste
    // must never silently attach to the next one.
    setRewriteOf('');
  };

  const editRow = (key: string, fields: ParsedFields) =>
    setRows((current) =>
      current?.map((row) =>
        row.key === key ? { ...row, fields, problems: validateFields(fields) } : row,
      ) ?? null,
    );

  // COMMIT ONLY WHAT IS VALID AND NOT ALREADY COMMITTED. One malformed line
  // never rejects the paste; one committed line is never inserted twice
  // without the owner saying so.
  const { valid, insertable, alreadyCommitted } = useMemo(() => {
    const validRows = rows?.filter((row) => row.problems.length === 0) ?? [];
    const released = validRows.filter((row) => overrides.has(row.key));
    const held = validRows.filter((row) => !overrides.has(row.key));
    const parts = partitionAgainstCommitted(held, committedCounts);
    return {
      valid: validRows,
      insertable: [...parts.insertable, ...released],
      alreadyCommitted: parts.alreadyCommitted,
    };
  }, [rows, committedCounts, overrides]);
  const duplicateKeys = useMemo(
    () => new Set(alreadyCommitted.map((row) => row.key)),
    [alreadyCommitted],
  );
  const rejected = (rows?.length ?? 0) - valid.length;

  /**
   * Sessions and errors are two writes with no transaction across them, so the
   * order and the retry story carry the safety:
   *
   * - Sessions FIRST: if the error insert fails, raw_feedback has already
   *   survived — the reverse order re-creates the very bug the sessions table
   *   fixes (practice with no session row).
   * - Two separate run() calls, so a failure toast names what actually failed
   *   and "nothing was saved" is never claimed over a half-saved commit.
   * - ALL post-success bookkeeping lives INSIDE each action: the toast's
   *   retry re-runs the captured action alone, so anything left outside it
   *   would be skipped on a successful retry — committed rows would stay
   *   "insertable" and re-insert on the next click.
   * - sessionPairsRef is mutated, not set through state, so a retried closure
   *   sees the pairs the first attempt already wrote.
   */
  const commit = async () => {
    if (insertable.length === 0) return;
    const sourceText = text;
    const batch = insertable;
    const rejectedCount = rejected;
    const revision = rewriteOf || undefined;

    const pairs = [
      ...new Map(
        batch.map((row) => [
          pairKey(row.fields.date, row.fields.skill),
          { date: row.fields.date, skill: row.fields.skill },
        ]),
      ).values(),
    ];
    const freshPairs = pairs.filter(
      (pair) => sessionPairsRef.current.get(pairKey(pair.date, pair.skill)) !== sourceText,
    );

    let sessionCount = 0;
    if (freshPairs.length > 0) {
      const sessions = await run('Record session', async () => {
        const created = await repository.createIeltsSessions(
          freshPairs.map((pair) => ({
            date: pair.date,
            skill: pair.skill,
            rawFeedback: sourceText,
            revisionOf: revision,
          })),
        );
        for (const pair of freshPairs) {
          sessionPairsRef.current.set(pairKey(pair.date, pair.skill), sourceText);
        }
        onSessions(created);
        return created;
      });
      // Session write failed: nothing was saved, the toast said so honestly,
      // and the error rows are not attempted without their session.
      if (!sessions) return;
      sessionCount = sessions.length;
    }

    await run('Log errors', async () => {
      const errors = await repository.createIeltsErrors(
        batch.map((row) => ({
          date: row.fields.date,
          skill: row.fields.skill,
          criterion: row.fields.criterion,
          failureMode: row.fields.failureMode,
          quote: row.fields.quote,
          note: row.fields.note,
          questionType: row.fields.questionType,
        })),
      );
      setCommittedCounts((current) => {
        const next = new Map(current);
        for (const row of batch) {
          const key = fieldsSignature(row.fields);
          next.set(key, (next.get(key) ?? 0) + 1);
        }
        return next;
      });
      onCommitted(errors);
      // Say how many were skipped — never silently drop a row.
      const sessionNote =
        sessionCount > 0
          ? ` ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} recorded.`
          : '';
      setCommitted(
        rejectedCount > 0
          ? `${errors.length} committed, ${rejectedCount} left below unresolved.${sessionNote}`
          : `${errors.length} committed.${sessionNote}`,
      );
      setRows((current) => current?.filter((row) => row.problems.length > 0) ?? null);
      setOverrides(new Set());
      if (rejectedCount === 0) setText('');
      return errors;
    });
  };

  // THE CLEAN-SESSION PATH — the entire point of the sessions table. A paste
  // with zero error rows is still a session; before this table existed it
  // produced no row, no date, no session, and `isolated` was unreachable. One
  // tap on the skill records it, full paste kept as raw_feedback. Same retry
  // rules as commit: bookkeeping inside the action, pair guard through the ref.
  const logCleanSession = async (skill: IeltsErrorSkill) => {
    const sourceText = text;
    const key = pairKey(cleanDate, skill);
    if (sessionPairsRef.current.get(key) === sourceText) {
      setCommitted(`Already recorded — ${IELTS_ERROR_TAXONOMY[skill].label} on ${cleanDate}.`);
      return;
    }
    await run('Log clean session', async () => {
      const created = await repository.createIeltsSessions([
        {
          date: cleanDate,
          skill,
          rawFeedback: sourceText,
          revisionOf: rewriteOf || undefined,
        },
      ]);
      sessionPairsRef.current.set(key, sourceText);
      onSessions(created);
      setCommitted(
        `Clean session recorded — ${IELTS_ERROR_TAXONOMY[skill].label}, ${cleanDate}. No errors, and that now counts.`,
      );
      return created;
    });
  };

  return (
    <div className="space-y-5">
      <MarkingPrompt />

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Log errors</CardTitle>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              Paste the model's entire reply — review, prose and log. Nothing needs trimming.
              Committing also records the practice session and keeps the full review.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder="Paste the whole marking response here…"
            aria-label="Marking response"
            className="w-full resize-y border border-input bg-card px-3 py-2 text-[11px] leading-5 text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={preview} disabled={!text.trim()}>
              Find rows
            </Button>
            {rows && rows.length > 0 && (
              <>
                <Button onClick={() => void commit()} disabled={isPending || insertable.length === 0}>
                  <Save className="size-4" />
                  Commit {insertable.length} valid
                </Button>
                <label className="flex items-center gap-1.5">
                  <span className="surface-label whitespace-nowrap">Rewrite of</span>
                  <Input
                    type="date"
                    value={rewriteOf}
                    onChange={(event) => setRewriteOf(event.target.value)}
                    className="w-auto"
                    aria-label="Date of the piece this session rewrites (optional)"
                  />
                </label>
              </>
            )}
            {rows && (
              <span className="text-xs text-foreground-muted">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'} found, {insertable.length} to
                commit
                {alreadyCommitted.length > 0 && `, ${alreadyCommitted.length} already committed`}
                {rejected > 0 && `, ${rejected} ${rejected === 1 ? 'needs' : 'need'} attention`}
                {discardedHeaders > 0 &&
                  `. ${discardedHeaders} header ${discardedHeaders === 1 ? 'row' : 'rows'} discarded`}
                .
              </span>
            )}
            {committed && <span className="text-xs text-success">{committed}</span>}
          </div>

          {/* Zero rows found is stated plainly — and offered as what it most
              often IS: a clean session. The parser wanted rows; a genuinely
              error-free marking response has none, and before the sessions
              table that practice simply vanished from the denominator. */}
          {rows?.length === 0 && (
            <div className="mt-3 space-y-3">
              <div className="border border-success/40 bg-success/5 p-3">
                <p className="text-xs font-semibold text-foreground">
                  No error rows in that paste. A clean session?
                </p>
                <p className="mt-1 text-xs leading-5 text-foreground-secondary">
                  Record it — a session with no errors is the strongest evidence a mode stopped
                  recurring, and it counts toward the denominator. One tap:
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={cleanDate}
                    onChange={(event) => setCleanDate(event.target.value)}
                    className="w-auto"
                    aria-label="Clean session date"
                  />
                  <label className="flex items-center gap-1.5">
                    <span className="surface-label whitespace-nowrap">Rewrite of</span>
                    <Input
                      type="date"
                      value={rewriteOf}
                      onChange={(event) => setRewriteOf(event.target.value)}
                      className="w-auto"
                      aria-label="Date of the piece this clean session rewrites (optional)"
                    />
                  </label>
                  {IELTS_ERROR_SKILLS.map((skill) => (
                    <Button
                      key={skill}
                      size="sm"
                      variant="secondary"
                      disabled={isPending || !cleanDate}
                      onClick={() => void logCleanSession(skill)}
                    >
                      {IELTS_ERROR_TAXONOMY[skill].label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="border border-escalate/40 bg-escalate/5 p-3">
                <p className="text-xs text-foreground-secondary">
                  Expecting errors? The parser scans every line, inside a fence or not, for this
                  shape:
                </p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border border-border-subtle bg-surface-2 p-3 text-[11px] leading-5 text-foreground-secondary">
                  {PARSER_EXPECTATION}
                </pre>
              </div>
            </div>
          )}

          {rows && rows.length > 0 && (
            <div className="mt-3 space-y-2">
              {rows.map((row) => (
                <RowEditor
                  key={row.key}
                  row={row}
                  duplicate={duplicateKeys.has(row.key)}
                  onChange={(fields) => editRow(row.key, fields)}
                  onCommitAnyway={() =>
                    setOverrides((current) => new Set(current).add(row.key))
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
