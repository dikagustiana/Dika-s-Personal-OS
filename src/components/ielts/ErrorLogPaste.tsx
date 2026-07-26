import { AlertTriangle, Check, Copy, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Input } from '../ui/Input';
import type { IeltsError, IeltsErrorSkill } from '../../data/types';
import {
  PARSER_EXPECTATION,
  parseErrorLog,
  validateFields,
  type ParsedFields,
} from '../../logic/ielts/parseErrorLog';
import { prIeltsMarking } from '../../logic/ielts/marking';
import { IELTS_ERROR_SKILLS, IELTS_ERROR_TAXONOMY } from '../../logic/ielts/taxonomy';
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
 */

interface EditableRow {
  key: string;
  line: number;
  raw: string;
  fields: ParsedFields;
  problems: readonly string[];
}

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
  onChange,
}: {
  row: EditableRow;
  onChange: (fields: ParsedFields) => void;
}) {
  const taxonomy = IELTS_ERROR_TAXONOMY[row.fields.skill];
  const valid = row.problems.length === 0;

  return (
    <div
      className={cn(
        'border-l-2 py-2 pl-3',
        valid ? 'border-success' : 'border-destructive bg-destructive/5',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs tabular-nums text-foreground-muted">line {row.line}</span>
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-wider',
            valid ? 'text-success' : 'text-destructive',
          )}
        >
          {valid ? 'Valid' : 'Needs attention'}
        </span>
      </div>

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
            value={row.fields.skill}
            onChange={(event) =>
              onChange({ ...row.fields, skill: event.target.value as IeltsErrorSkill })
            }
            aria-label={`Skill, line ${row.line}`}
          >
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
            value={taxonomy.criteria.includes(row.fields.criterion) ? row.fields.criterion : ''}
            onChange={(event) => onChange({ ...row.fields, criterion: event.target.value })}
            aria-label={`Criterion, line ${row.line}`}
          >
            <option value="">{row.fields.criterion || '— pick one —'}</option>
            {taxonomy.criteria.map((criterion) => (
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
              taxonomy.modes.some((mode) => mode.mode === row.fields.failureMode)
                ? row.fields.failureMode
                : ''
            }
            onChange={(event) => onChange({ ...row.fields, failureMode: event.target.value })}
            aria-label={`Failure mode, line ${row.line}`}
          >
            <option value="">{row.fields.failureMode || '— pick one —'}</option>
            {taxonomy.modes.map((mode) => (
              <option key={mode.mode} value={mode.mode}>
                {mode.mode}
              </option>
            ))}
            <option value="UNCLASSIFIED">UNCLASSIFIED</option>
          </select>
        </label>
        {/* Only meaningful for the two skills that have question types. */}
        {taxonomy.usesQuestionType && (
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
        <label className="block">
          <span className="surface-label">Rewrite of (optional)</span>
          <Input
            type="date"
            className="mt-1"
            value={row.fields.revisionOf ?? ''}
            onChange={(event) =>
              onChange({ ...row.fields, revisionOf: event.target.value || undefined })
            }
            aria-label={`Rewrite of, line ${row.line}`}
          />
        </label>
      </div>

      <p className="mt-2 break-words text-xs leading-5 text-foreground-secondary">
        {row.fields.quote}
      </p>
      {row.fields.note && (
        <p className="mt-0.5 break-words text-xs leading-5 text-foreground-muted">
          {row.fields.note}
        </p>
      )}
    </div>
  );
}

export function ErrorLogPaste({ onCommitted }: { onCommitted: (rows: IeltsError[]) => void }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<EditableRow[] | null>(null);
  const [discardedHeaders, setDiscardedHeaders] = useState(0);
  const [committed, setCommitted] = useState<string | null>(null);
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
  };

  const editRow = (key: string, fields: ParsedFields) =>
    setRows((current) =>
      current?.map((row) =>
        row.key === key ? { ...row, fields, problems: validateFields(fields) } : row,
      ) ?? null,
    );

  // COMMIT ONLY WHAT IS VALID. One malformed line never rejects the paste.
  const valid = rows?.filter((row) => row.problems.length === 0) ?? [];
  const rejected = (rows?.length ?? 0) - valid.length;

  const commit = async () => {
    if (valid.length === 0) return;
    // ONE insert for the whole paste — see Repository.createIeltsErrors.
    const created = await run('Log errors', async () =>
      repository.createIeltsErrors(
        valid.map((row) => ({
          date: row.fields.date,
          skill: row.fields.skill,
          criterion: row.fields.criterion,
          failureMode: row.fields.failureMode,
          quote: row.fields.quote,
          note: row.fields.note,
          questionType: row.fields.questionType,
          revisionOf: row.fields.revisionOf,
        })),
      ),
    );
    if (!created) return;
    onCommitted(created);
    // Say how many were skipped — never silently drop a row.
    setCommitted(
      rejected > 0
        ? `${created.length} committed, ${rejected} left below unresolved.`
        : `${created.length} committed.`,
    );
    setRows((current) => current?.filter((row) => row.problems.length > 0) ?? null);
    if (rejected === 0) setText('');
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
              <Button onClick={() => void commit()} disabled={isPending || valid.length === 0}>
                <Save className="size-4" />
                Commit {valid.length} valid
              </Button>
            )}
            {rows && (
              <span className="text-xs text-foreground-muted">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'} found, {valid.length} valid
                {rejected > 0 && `, ${rejected} ${rejected === 1 ? 'needs' : 'need'} attention`}
                {discardedHeaders > 0 &&
                  `. ${discardedHeaders} header ${discardedHeaders === 1 ? 'row' : 'rows'} discarded`}
                .
              </span>
            )}
            {committed && <span className="text-xs text-success">{committed}</span>}
          </div>

          {/* Zero rows found is stated plainly, with what the parser wanted —
              a paste that looked like it should have worked must never fail
              silently. */}
          {rows?.length === 0 && (
            <div className="mt-3 border border-escalate/40 bg-escalate/5 p-3">
              <p className="text-xs font-semibold text-foreground">
                No rows found in that paste.
              </p>
              <p className="mt-1 text-xs text-foreground-secondary">
                The parser scans every line, inside a fence or not, for this shape:
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border border-border-subtle bg-surface-2 p-3 text-[11px] leading-5 text-foreground-secondary">
                {PARSER_EXPECTATION}
              </pre>
            </div>
          )}

          {rows && rows.length > 0 && (
            <div className="mt-3 space-y-2">
              {rows.map((row) => (
                <RowEditor
                  key={row.key}
                  row={row}
                  onChange={(fields) => editRow(row.key, fields)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
