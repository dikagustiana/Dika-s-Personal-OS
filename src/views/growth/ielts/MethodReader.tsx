import { useEffect, useMemo, useRef, type ComponentType, type ReactNode } from 'react';
import { FileQuestion } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { IeltsPrepSkill, IeltsTopic } from '../../../data/types';
import { methodPageFor, STUB_SLUGS } from './methodPages';

/**
 * THE METHOD READER — the destination half of the integration.
 *
 * It renders one MDX page, chosen by slug, with a skill-scoped index beside
 * it. The slug it is given comes either from this index or from a weakness
 * row; both paths land on the same page for the same slug, which is the only
 * property that matters here.
 *
 * MDX ELEMENT OVERRIDES, and why they are not optional. The Notion source is
 * mostly tables, so unstyled `<table>` output would render the majority of
 * this content as browser-default black-on-white in an app that has a dark
 * theme. Every element the content can produce is mapped below.
 */

const SKILL_LABELS: Record<IeltsPrepSkill, string> = {
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
  speaking: 'Speaking',
};

/** The callout the extraction maps Notion's `<callout>` blocks onto. */
function Callout({ children, tone }: { children?: ReactNode; tone?: string }) {
  const empty = tone === 'empty';
  return (
    <aside
      className={cn(
        'my-5 border-l-2 py-3 pl-4 pr-3 text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        empty
          ? 'border-border bg-surface-2/60 text-foreground-muted'
          : 'border-primary bg-surface-2 text-foreground-secondary',
      )}
    >
      {children}
    </aside>
  );
}

type AnyProps = Record<string, unknown>;
const asChildren = (props: AnyProps): ReactNode => props.children as ReactNode;

const MDX_COMPONENTS: Record<string, ComponentType<AnyProps>> = {
  Callout: Callout as ComponentType<AnyProps>,
  h1: (props) => <h2 className="mt-8 font-serif text-2xl font-semibold">{asChildren(props)}</h2>,
  h2: (props) => (
    <h2 className="mt-8 border-b border-border-subtle pb-2 font-serif text-xl font-semibold">
      {asChildren(props)}
    </h2>
  ),
  h3: (props) => <h3 className="mt-6 text-base font-bold">{asChildren(props)}</h3>,
  h4: (props) => (
    <h4 className="mt-5 text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
      {asChildren(props)}
    </h4>
  ),
  p: (props) => <p className="my-3 text-sm leading-6 text-foreground-secondary">{asChildren(props)}</p>,
  ul: (props) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-foreground-secondary">{asChildren(props)}</ul>,
  ol: (props) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-foreground-secondary">{asChildren(props)}</ol>,
  li: (props) => <li className="pl-1">{asChildren(props)}</li>,
  strong: (props) => <strong className="font-semibold text-foreground">{asChildren(props)}</strong>,
  em: (props) => <em className="text-foreground-muted">{asChildren(props)}</em>,
  hr: () => <hr className="my-7 border-border-subtle" />,
  a: (props) => (
    <a
      href={props.href as string}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-4"
    >
      {asChildren(props)}
    </a>
  ),
  code: (props) => (
    <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{asChildren(props)}</code>
  ),
  blockquote: (props) => (
    <blockquote className="my-4 border-l-2 border-border pl-4 text-sm italic text-foreground-muted">
      {asChildren(props)}
    </blockquote>
  ),
  // Wide tables scroll INSIDE their own container. The band-descriptor tables
  // are five columns of prose and would otherwise put the whole page into
  // horizontal scroll on a phone.
  table: (props) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full min-w-[26rem] border-collapse text-sm">{asChildren(props)}</table>
    </div>
  ),
  thead: (props) => <thead className="border-b border-border">{asChildren(props)}</thead>,
  tbody: (props) => <tbody className="divide-y divide-border-subtle">{asChildren(props)}</tbody>,
  tr: (props) => <tr>{asChildren(props)}</tr>,
  th: (props) => (
    <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
      {asChildren(props)}
    </th>
  ),
  td: (props) => (
    <td className="px-2 py-2 align-top leading-6 text-foreground-secondary">{asChildren(props)}</td>
  ),
  details: (props) => (
    <details className="my-2 border border-border-subtle bg-surface-2/50 px-3 py-2 text-sm">
      {asChildren(props)}
    </details>
  ),
  summary: (props) => (
    <summary className="cursor-pointer select-none py-1 font-semibold text-foreground">
      {asChildren(props)}
    </summary>
  ),
};

export function MethodReader({
  topics,
  slug,
  onSelect,
}: {
  topics: readonly IeltsTopic[];
  slug: string;
  onSelect: (slug: string) => void;
}) {
  const skill = (slug.split('/')[0] as IeltsPrepSkill) ?? 'reading';
  const Page = methodPageFor(slug);
  const headingRef = useRef<HTMLDivElement>(null);

  const bySkill = useMemo(() => {
    const groups = new Map<IeltsPrepSkill, IeltsTopic[]>();
    for (const topic of [...topics].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = groups.get(topic.skill) ?? [];
      list.push(topic);
      groups.set(topic.skill, list);
    }
    return groups;
  }, [topics]);

  const current = topics.find((topic) => topic.slug === slug);

  // Arriving from a weakness row lands mid-page otherwise: the reader sits
  // below a tab bar, and the click that got here was several hundred pixels
  // down the previous tab.
  useEffect(() => {
    headingRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [slug]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)]">
      <nav aria-label="Method pages" className="lg:sticky lg:top-4 lg:max-h-[80vh] lg:self-start lg:overflow-y-auto">
        {(Object.keys(SKILL_LABELS) as IeltsPrepSkill[]).map((key) => {
          const list = bySkill.get(key) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={key} className="mb-5">
              <p className="surface-label mb-2">{SKILL_LABELS[key]}</p>
              <ul className="space-y-px">
                {list.map((topic) => {
                  const active = topic.slug === slug;
                  return (
                    <li key={topic.slug}>
                      <button
                        type="button"
                        onClick={() => onSelect(topic.slug)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active
                            ? 'bg-surface-2 font-semibold text-foreground'
                            : 'text-foreground-muted hover:text-foreground-secondary',
                        )}
                      >
                        <span className="min-w-0 truncate">{topic.label}</span>
                        {/* Marked in the index too, so the gaps are legible as
                            a shape rather than discovered one click at a time. */}
                        {STUB_SLUGS.has(topic.slug) && (
                          <FileQuestion
                            className="size-3 shrink-0 text-foreground-muted"
                            aria-label="no method captured"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <article className="min-w-0 scroll-mt-4" ref={headingRef}>
        <p className="page-kicker">{SKILL_LABELS[skill]}</p>
        <h2 className="mb-1 mt-2 font-serif text-2xl font-semibold">{current?.label ?? slug}</h2>
        <p className="mb-6 font-mono text-[11px] text-foreground-muted">{slug}</p>

        {Page ? (
          <Page components={MDX_COMPONENTS} />
        ) : (
          // Unreachable while topicContent.test.ts passes — it fails the build
          // if any slug lacks a file. Rendered honestly anyway rather than
          // crashing the tab, because the alternative to a missing page should
          // never be a blank screen.
          <p className="text-sm text-destructive">
            No method page is registered for <code>{slug}</code>.
          </p>
        )}
      </article>
    </div>
  );
}
