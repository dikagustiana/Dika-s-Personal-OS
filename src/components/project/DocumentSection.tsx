import { ExternalLink, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import type { ProjectDocument } from '../../data/types';
import { makeDocument } from '../../logic/documents';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

/**
 * Document lists, shared by the project-level section and each milestone row.
 *
 * "Upload" is a deliberate misnomer kept because it is what the affordance
 * looks like: a dashed drop zone with an upload icon. What it actually
 * collects is a label and a URL. No file is read, no binary leaves the
 * browser, and dropping a file only borrows its name as a default label.
 */

export function DocumentLinks({
  documents,
  onRemove,
  ariaContext,
  className,
}: {
  documents: ProjectDocument[];
  onRemove?: (index: number) => void;
  /** Names the owner in remove-button labels ("Remove Brief from Q3 close"). */
  ariaContext: string;
  className?: string;
}) {
  if (documents.length === 0) return null;
  return (
    <ul className={cn('space-y-1', className)}>
      {documents.map((document, index) => (
        <li key={`${document.url}-${document.addedAt}`} className="flex items-center gap-2">
          <FileText className="size-3.5 shrink-0 text-foreground-muted" />
          <a
            className="min-w-0 flex-1 truncate text-xs text-foreground-secondary underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={document.url}
            target="_blank"
            rel="noreferrer noopener"
            title={document.url}
          >
            {document.label}
          </a>
          <ExternalLink className="size-3 shrink-0 text-foreground-muted" aria-hidden />
          {onRemove && (
            <button
              type="button"
              className="shrink-0 rounded-sm p-1 text-foreground-muted transition-colors duration-150 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onRemove(index)}
              aria-label={`Remove ${document.label} from ${ariaContext}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

interface UploadProps {
  /** Appends the built document. The caller owns persistence. */
  onAdd: (document: ProjectDocument) => void | Promise<void>;
  /** Names the target in labels — "Add document to Q3 close". */
  ariaContext: string;
  /** Milestone rows use a single text affordance instead of a drop zone. */
  variant?: 'zone' | 'inline';
  disabled?: boolean;
}

export function DocumentUpload({
  onAdd,
  ariaContext,
  variant = 'zone',
  disabled = false,
}: UploadProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setLabel('');
    setUrl('');
    setError(null);
    setOpen(false);
  };

  const submit = async () => {
    const document = makeDocument(label, url, new Date());
    if (!document) {
      setError('Needs a web link (http or https).');
      urlRef.current?.focus();
      return;
    }
    await onAdd(document);
    reset();
  };

  // A dropped file is used for its NAME and nothing else — it is never read,
  // never encoded, never sent. The person still has to paste the link.
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    setOpen(true);
    if (dropped && !label) setLabel(dropped.name);
    requestAnimationFrame(() => urlRef.current?.focus());
  };

  const form = (
    <div className="mt-2 grid gap-2">
      <Input
        className="h-9 text-sm"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="Label — e.g. Master instructions"
        aria-label={`Document label for ${ariaContext}`}
      />
      <Input
        ref={urlRef}
        className="h-9 text-sm"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
          if (event.key === 'Escape') reset();
        }}
        placeholder="Paste a link — e.g. a Drive URL"
        aria-label={`Document link for ${ariaContext}`}
        aria-invalid={error ? true : undefined}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={disabled}>
          <Plus className="size-3.5" />
          Add link
        </Button>
        <Button size="sm" variant="secondary" onClick={reset}>
          <X className="size-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return open ? (
      form
    ) : (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm text-xs text-foreground-muted transition-colors duration-150 hover:text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`Add document to ${ariaContext}`}
      >
        <Plus className="size-3" />
        add document
      </button>
    );
  }

  return (
    <div
      className={cn(
        'mt-2 rounded-md border border-dashed p-4 transition-colors duration-150',
        dragging ? 'border-primary bg-primary-dim/30' : 'border-border',
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {open ? (
        form
      ) : (
        <button
          type="button"
          className="flex w-full flex-col items-center gap-1 rounded-sm py-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-label={`Upload document to ${ariaContext}`}
        >
          <Upload className="size-4 text-foreground-muted" />
          <span className="text-xs font-semibold text-foreground-secondary">
            Upload document
          </span>
          <span className="text-[11px] text-foreground-muted">
            Links only — paste a URL, or drop a file to borrow its name
          </span>
        </button>
      )}
    </div>
  );
}
