import { useEffect, useRef } from 'react';
import { parseMarkdown, type Inline } from '../../../../logic/floor/text/markdown';
import { shouldRedact } from '../../../../logic/floor/institution/redact';
import { useUiStore } from '../store/uiStore';
import { useAssignmentOutput } from './corpusOutput';

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((i, k) =>
        i.kind === 'bold' ? (
          <strong key={k}>{i.text}</strong>
        ) : i.kind === 'code' ? (
          <code key={k} className="rounded bg-surface-3 px-1 tabular-nums text-[0.9em]">
            {i.text}
          </code>
        ) : (
          <span key={k}>{i.text}</span>
        ),
      )}
    </>
  );
}

/** The output document, rendered from markdown as React nodes. A DOM modal outside the canvas. */
export function OutputModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  // The document is a CORPUS RECORD, read through the repository: the same
  // row a later piece of work would cite, with its hash beside it.
  const output = useAssignmentOutput(taskId);
  const document_ = output.status === 'ready' ? output.document : null;
  // 3-C: an INTERNAL-lane record is SAMB's own writing. The modal is the
  // largest block of it the floor can put on screen, so it stays behind the
  // same session toggle as everything else — and the hash, the lane and the
  // time still show, because those are what tell the director there IS a
  // document without showing what it says.
  const reveal = useUiStore((state) => state.revealInternal);
  const setReveal = useUiStore((state) => state.setRevealInternal);
  const hidden = document_ ? shouldRedact(document_, { reveal }) : false;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const parsed = document_ ? parseMarkdown(document_.content) : [];
  const first = parsed[0];
  const blocks =
    first && first.kind === 'heading' && first.level === 1 && first.inlines.map((i) => i.text).join('') === document_?.title ? parsed.slice(1) : parsed;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={onClose} role="presentation">
      <div
        className="floor-panel max-h-[80vh] w-full max-w-[640px] overflow-y-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="floor-output-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 id="floor-output-title" className="text-lg font-semibold">
              {hidden ? 'Internal-lane document' : document_?.title ?? 'Output document'}
            </h2>
            {document_ ? (
              <p className="text-xs text-foreground-muted">
                {document_.dataClass} lane · generated {new Date(document_.generatedAt).toLocaleTimeString()} ·
                sha256 {document_.contentHash.slice(0, 12)}…
              </p>
            ) : null}
          </div>
          <button ref={closeRef} type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary" onClick={onClose}>
            Close
          </button>
        </div>
        {output.status === 'loading' ? <p className="text-sm text-foreground-muted">Reading the archive…</p> : null}
        {output.status === 'error' ? (
          <p className="text-sm text-destructive">Could not read the archive — not "no output". {output.detail}</p>
        ) : null}
        {output.status === 'none' ? <p className="text-sm text-foreground-muted">This assignment has produced no archived output yet.</p> : null}
        {hidden ? (
          <div className="space-y-2 text-sm leading-6">
            <p className="text-escalate">
              This record is in the internal lane. Its text is hidden by default — a screenshot leaks what
              the render does not.
            </p>
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:border-primary"
              onClick={() => setReveal(true)}
            >
              Show for this session
            </button>
          </div>
        ) : null}
        <div className="space-y-2 text-sm leading-6">
          {(hidden ? [] : blocks).map((b, i) => {
            if (b.kind === 'heading') {
              const cls = b.level === 1 ? 'text-lg font-semibold mt-2' : b.level === 2 ? 'text-base font-semibold mt-3' : 'text-sm font-semibold mt-2';
              return (
                <p key={i} className={cls}>
                  <Inlines inlines={b.inlines} />
                </p>
              );
            }
            if (b.kind === 'list') {
              return (
                <ul key={i} className="ml-1 space-y-0.5">
                  {b.items.map((it, k) => (
                    <li key={k} className="flex gap-2">
                      <span className="w-4 shrink-0 text-foreground-muted" aria-hidden="true">
                        {it.checked === null ? '•' : it.checked ? '☑' : '☐'}
                      </span>
                      <span className={it.checked ? 'text-foreground' : ''}>
                        <Inlines inlines={it.inlines} />
                      </span>
                    </li>
                  ))}
                </ul>
              );
            }
            if (b.kind === 'code') {
              return (
                <pre key={i} className="overflow-x-auto rounded-md bg-black/40 p-3 tabular-nums text-xs">
                  {b.text}
                </pre>
              );
            }
            return (
              <p key={i}>
                <Inlines inlines={b.inlines} />
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}
