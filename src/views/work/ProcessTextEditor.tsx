/**
 * READ FIRST, EDIT ON REQUEST — the shape every process panel now follows.
 *
 * A panel opens in READING state. Nothing is an input until someone asks for
 * it, because these panels are read far more often than they are written and
 * a wall of boxes would make the reading job worse to serve the rarer one.
 * One affordance switches; save and cancel are explicit; leaving dirty asks.
 *
 * NO AUTOSAVE, deliberately. The prose here is expensive — a note like
 * "TIDAK ADA GRN DAN TIDAK ADA GR/IR" is a conclusion someone reached, not a
 * form field — and autosave turns a stray keystroke into a permanent edit
 * with no moment at which the person said "yes, that one".
 *
 * NO ANIMATION on this path at all. Editing is not a place for motion.
 *
 * The list fields (docs / drivers / coa) are textareas, one item per line,
 * and their parsers REJECT malformed input naming the line number rather than
 * dropping it — see logic/processTextEdit.ts. Silent loss is the failure this
 * whole feature is built to avoid.
 */
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { cn } from '../../lib/utils';
import type { ParseFailure } from '../../logic/processTextEdit';

// --- primitives -------------------------------------------------------------

const LABEL = 'surface-label mb-1 block';
const FIELD =
  'w-full rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-xs leading-5 text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function EditField({
  label,
  value,
  onChange,
  rows = 1,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className={LABEL}>{label}</span>
      {rows > 1 ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={cn(FIELD, 'resize-y')}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        />
      )}
    </label>
  );
}

/**
 * A select over the column's CHECK vocabulary. A free-text field here would
 * let the user compose a value the database will reject, and learning a rule
 * from a failed save is the worst way to learn it.
 */
export function EditSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void;
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className={LABEL}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EditDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="mt-3 flex items-center gap-2 text-[11px] text-foreground-muted first:mt-0">
      {label}
      <Input
        type="date"
        className="!h-8 !w-auto text-xs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * The parse failures, listed. Every bad line at once — fixing them one round
 * trip at a time is its own small punishment — and each names its line.
 */
export function ParseErrors({ errors }: { errors: ParseFailure[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 rounded-sm border border-destructive/40 bg-destructive/5 px-2 py-1.5">
      {errors.map((error) => (
        <li key={`${error.line}-${error.message}`} className="text-[11px] leading-4 text-destructive">
          {error.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Save / cancel. Save is the ONE filled primary in the panel — it is the
 * single thing the panel exists to commit, which is exactly what that
 * treatment is for. Cancel stays quiet beside it.
 */
export function EditActions({
  onSave,
  onCancel,
  isPending,
  disabled,
}: {
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-border-subtle pt-3">
      <Button size="sm" onClick={onSave} disabled={isPending || disabled}>
        Simpan
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
        Batal
      </Button>
    </div>
  );
}

/** The affordance into edit mode. Quiet — reading is the default job. */
export function EditTrigger({ onClick, label = 'Edit teks' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-[11px] font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </button>
  );
}

/**
 * Leaving with unsaved work asks first. Rendered inline rather than as a
 * window.confirm so it is testable and so it matches the app's surfaces.
 */
export function DiscardPrompt({
  onDiscard,
  onKeepEditing,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  return (
    <div className="mt-3 rounded-sm border border-escalate/40 bg-escalate/5 px-3 py-2">
      <p className="text-[11px] leading-4 text-foreground">
        Ada perubahan yang belum disimpan. Buang perubahannya?
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Buang perubahan
        </Button>
        <Button variant="ghost" size="sm" onClick={onKeepEditing}>
          Lanjut mengedit
        </Button>
      </div>
    </div>
  );
}

/**
 * The read/edit switch, with the dirty-exit guard wired in once so no panel
 * has to remember it. `dirty` is computed by the caller from the same diff
 * the audit log uses, so "changed" means one thing everywhere.
 */
export function useEditMode(dirty: boolean) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return {
    editing,
    confirming,
    start: () => {
      setConfirming(false);
      setEditing(true);
    },
    /** Cancel: asks when there is something to lose, leaves immediately when not. */
    requestCancel: () => {
      if (dirty) setConfirming(true);
      else setEditing(false);
    },
    discard: () => {
      setConfirming(false);
      setEditing(false);
    },
    keepEditing: () => setConfirming(false),
    finish: () => {
      setConfirming(false);
      setEditing(false);
    },
  };
}

export function PanelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-border-subtle pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <p className="surface-label mb-1.5">{title}</p>
      {children}
    </div>
  );
}
