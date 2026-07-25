import { Link2 } from 'lucide-react';
import type { LinkedProject, Project } from '../../data/types';
import { cn } from '../../lib/utils';

/**
 * The linked-projects row.
 *
 * A link is a soft pointer and nothing more: a title to recognise, a note to
 * remember why, and a way to get there. Nothing here reads or writes the
 * linked project's state, and no status change anywhere in the app consults
 * this list. That is a decision on the record, not an oversight.
 *
 * Titles resolve live from the project list on every render — a chip must
 * never show a title that was cached when the link was made.
 */
export function LinkedSection({
  links,
  projectsById,
  onNavigate,
  className,
}: {
  links: LinkedProject[];
  projectsById: Map<string, Project>;
  /** Absent in read-only contexts; the chip then renders as plain text. */
  onNavigate?: (projectId: string) => void;
  className?: string;
}) {
  return (
    <section className={className} aria-label="Linked projects">
      <p className="surface-label">Linked</p>
      {links.length === 0 ? (
        <p className="mt-1.5 text-xs text-foreground-muted">No linked projects</p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {links.map((link) => {
            const target = projectsById.get(link.projectId);
            const title = target?.title ?? 'Project not in this list';
            const chip = cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-sm border px-2 py-1 text-xs',
              target
                ? 'border-border-subtle bg-surface-2 text-foreground-secondary'
                : 'border-border-subtle bg-surface-2 text-foreground-muted',
            );
            const body = (
              <>
                <Link2 className="size-3 shrink-0 text-foreground-muted" aria-hidden />
                <span className="truncate">{title}</span>
                {link.note && (
                  <span className="truncate text-foreground-muted">· {link.note}</span>
                )}
              </>
            );
            return (
              <li key={link.projectId} className="min-w-0">
                {target && onNavigate ? (
                  <button
                    type="button"
                    className={cn(
                      chip,
                      'transition-colors duration-150 hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                    onClick={() => onNavigate(link.projectId)}
                    title={link.note ?? title}
                    aria-label={`Go to ${title}`}
                  >
                    {body}
                  </button>
                ) : (
                  <span className={chip} title={link.note ?? title}>
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
