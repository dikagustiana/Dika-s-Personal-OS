'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { parseMarkdown, type Inline } from '@/core/text/markdown';
import { fetchOutput } from './api';

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((i, k) =>
        i.kind === 'bold' ? (
          <strong key={k}>{i.text}</strong>
        ) : i.kind === 'code' ? (
          <code key={k} className="rounded bg-white/10 px-1 font-mono text-[0.9em]">
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
  const q = useQuery({ queryKey: ['output', taskId], queryFn: () => fetchOutput(taskId), retry: false });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const parsed = q.data ? parseMarkdown(q.data.content) : [];
  const first = parsed[0];
  const blocks =
    first && first.kind === 'heading' && first.level === 1 && first.inlines.map((i) => i.text).join('') === q.data?.title ? parsed.slice(1) : parsed;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={onClose} role="presentation">
      <div
        className="bc-panel max-h-[80vh] w-full max-w-[640px] overflow-y-auto p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bc-output-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 id="bc-output-title" className="text-lg font-semibold">
              {q.data?.title ?? 'Output document'}
            </h2>
            {q.data ? (
              <p className="text-xs text-ink-muted">
                {q.data.agentId} · {q.data.department} · generated {new Date(q.data.generatedAt).toLocaleTimeString()}
              </p>
            ) : null}
          </div>
          <button ref={closeRef} type="button" className="rounded-panel border border-white/10 px-2 py-1 text-xs hover:border-accent" onClick={onClose}>
            Close
          </button>
        </div>
        {q.isPending ? <p className="text-sm text-ink-muted">Loading…</p> : null}
        {q.isError ? <p className="text-sm text-error">Could not load the document. Close and try again.</p> : null}
        {q.data === null ? <p className="text-sm text-ink-muted">This task has no output yet.</p> : null}
        <div className="space-y-2 text-sm leading-6">
          {blocks.map((b, i) => {
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
                      <span className="w-4 shrink-0 text-ink-muted" aria-hidden="true">
                        {it.checked === null ? '•' : it.checked ? '☑' : '☐'}
                      </span>
                      <span className={it.checked ? 'text-ink' : ''}>
                        <Inlines inlines={it.inlines} />
                      </span>
                    </li>
                  ))}
                </ul>
              );
            }
            if (b.kind === 'code') {
              return (
                <pre key={i} className="overflow-x-auto rounded-panel bg-black/40 p-3 font-mono text-xs">
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
