import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Eye, Lock } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { fetchSharedView } from '../../data/supabaseRepository';
import type { FinishLineCell, SharedView } from '../../data/types';
import { cn } from '../../lib/utils';
import {
  buildMatrix,
  stateClauses,
  STATE_GLYPH,
  type MatrixSection,
} from '../../logic/finishLine';
import { accountsByCell, coverageOf } from '../../logic/finishLineAccounts';
import {
  refusalCopy,
  shareDate,
  shareTerms,
  SHARE_TOKEN_PATTERN,
} from '../../logic/shareLinks';
import { CellDetailPanel } from '../work/CellDetailPanel';
import { ROW_STYLE, STATE_TONE } from '../work/finishLineUi';

/**
 * ===========================================================================
 * WHAT A SHARE LINK OPENS. ONE PAGE, AND THERE IS NOWHERE ELSE TO GO.
 * ===========================================================================
 * NO NAVIGATION, BY CONSTRUCTION. This page renders above the passphrase gate
 * and outside AppShell entirely — there is no sidebar, no workspace switch and
 * no route to another view, because none of that is mounted. The only
 * interactive elements are a section fold and a cell that opens its own
 * detail in place. Nothing here can reach the owner's app.
 *
 * NO SCOPE ESCALATION. The page sends its token and nothing else. Every filter
 * was applied server-side before the payload existed, from the token's own
 * record — so editing an entity code in the address bar changes nothing except
 * possibly breaking the token, and the words below are rendered from what came
 * back rather than from what was asked for.
 *
 * NO WRITE PATH. This file holds no repository, no Supabase client and no app
 * key. Its whole capability is one POST that returns one view's data.
 *
 * THE PANEL IS THE OWNER'S OWN. CellDetailPanel has had zero edit affordances
 * since it moved from the row to the cell; reusing it means a recipient reads
 * a cell exactly as the owner does, and one panel cannot drift from the other.
 */

const HASH_PREFIX = '#share=';
const QUERY_KEY = 'share';

/**
 * Reads the share token from the URL.
 *
 * The link puts it in the FRAGMENT, which browsers never send to a server — so
 * it stays out of access logs and Referer headers on every hop between the
 * owner's message and the recipient's browser. A `?share=` query is accepted
 * too: a chat client that rewrites links would otherwise hand the recipient a
 * URL that cannot work, with no way to tell what went wrong.
 *
 * The token is deliberately NOT stripped from the URL afterwards, unlike the
 * recovery link. A recovery token is single-use and must not survive a reload;
 * a share link is meant to be reopened, and a page that broke on refresh would
 * be worse than one whose address bar holds its own credential.
 */
export function readShareToken(): string | null {
  const { hash, search } = window.location;
  const fromHash = hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : '';
  const candidate = fromHash || (new URLSearchParams(search).get(QUERY_KEY) ?? '');
  return SHARE_TOKEN_PATTERN.test(candidate) ? candidate : null;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'refused'; reason: string }
  | { kind: 'ok'; view: SharedView };

export function SharePage({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void fetchSharedView(token).then((result) => {
      if (!live) return;
      setLoad(
        result.ok ? { kind: 'ok', view: result.view } : { kind: 'refused', reason: result.reason },
      );
    });
    return () => {
      live = false;
    };
  }, [token]);

  if (load.kind === 'loading') return <Frame>Opening…</Frame>;
  if (load.kind === 'refused') return <Frame>{refusalCopy(load.reason)}</Frame>;
  return <SharedFinishLine view={load.view} />;
}

/** The centred card the two non-content states share with the unlock gate. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <div className="mb-4 grid size-10 place-items-center rounded-md border border-border bg-surface-2">
          <Lock className="size-5 text-foreground-secondary" />
        </div>
        <p className="text-sm leading-6 text-foreground-secondary">{children}</p>
      </div>
    </div>
  );
}

function SharedFinishLine({ view }: { view: SharedView }) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [openCellId, setOpenCellId] = useState<string | null>(null);

  const { entities, items, cells, accounts } = view.data;
  const now = useMemo(() => new Date(), []);

  // No resolutions: edges and projects are not shared, so a slot carries its
  // state and nothing else. Passing none is honest — a resolution computed
  // from an absent edge set would say "unplanned" about every cell in the
  // pack, which is a claim, and a false one.
  const matrix = useMemo(() => buildMatrix(items, cells, entities), [items, cells, entities]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const entityLabel = useMemo(
    () => new Map(entities.map((entity) => [entity.code, entity.label])),
    [entities],
  );
  const byCell = useMemo(() => accountsByCell(accounts), [accounts]);
  const coverage = useMemo(() => coverageOf(accounts), [accounts]);

  // Rendered from the payload's own scope, never from the URL. The recipient
  // reads the same sentence the owner was shown before creating the link.
  const terms = shareTerms({
    view: view.view,
    entityLabel: view.scope.entity ? entityLabel.get(view.scope.entity) : undefined,
    expiresAt: view.expiresAt,
    now,
  });
  const heading =
    view.scope.entity && entityLabel.get(view.scope.entity)
      ? `Finish line — ${entityLabel.get(view.scope.entity)}`
      : 'Finish line';

  return (
    <div className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-lg font-semibold text-foreground">{heading}</h1>
            <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary">
              <Eye className="size-3" />
              Read only
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-foreground-secondary">{terms.grants}</p>
          <p className="mt-0.5 text-xs leading-5 text-foreground-muted">{terms.withholds}</p>
        </header>

        <Legend />

        {matrix.length === 0 ? (
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-foreground-muted">
                There is nothing in this view yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              {/* 200 + 84 = the width of a ONE-column view, which is what an
                  entity link opens. The owner's matrix floors at 640px because
                  it always carries five columns; using that figure here made a
                  single column scroll sideways inside its own card on a phone
                  and clipped the section label. A group link has five columns,
                  naturally exceeds this, and scrolls in the card as it should —
                  the page itself never scrolls horizontally either way. */}
              <table className="w-full min-w-[284px] border-collapse text-sm">
                <thead className="sticky top-0 z-20 bg-card">
                  <tr>
                    <th className="sticky left-0 z-30 min-w-[200px] bg-card px-4 py-3 text-left">
                      <span className="surface-label">Line item</span>
                    </th>
                    {entities.map((entity) => (
                      <th
                        key={entity.code}
                        scope="col"
                        className="min-w-[84px] bg-card px-3 py-3 text-right"
                      >
                        <span className="surface-label">{entity.label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>

                {matrix.map((section) => (
                  <SectionBody
                    key={section.section.id}
                    section={section}
                    columns={entities.length}
                    // OPEN BY DEFAULT, unlike the owner's matrix. There, a
                    // section opens itself when it contains a gap — a triage
                    // signal computed from the resolutions. Nothing is
                    // resolved here, so that rule degrades to "always closed"
                    // and a recipient would open the link to two collapsed
                    // headers and no data. There is no triage to do on this
                    // page and no filter to reveal anything, so the content is
                    // the landing state.
                    open={openSections[section.section.id] ?? true}
                    onToggle={() =>
                      setOpenSections((current) => ({
                        ...current,
                        [section.section.id]: !(current[section.section.id] ?? true),
                      }))
                    }
                    openCellId={openCellId}
                    onToggleCell={(id) => setOpenCellId((current) => (current === id ? null : id))}
                    renderPanel={(cell) => (
                      <CellDetailPanel
                        cell={cell}
                        item={itemsById.get(cell.itemId)}
                        entityLabel={entityLabel.get(cell.entityCode) ?? cell.entityCode}
                        accounts={byCell.get(cell.id) ?? []}
                        // The payload either arrived whole or the page refused
                        // to render: there is no half-loaded state here, so the
                        // accounts are known by the time this can be opened.
                        accountsKnown
                        onClose={() => setOpenCellId(null)}
                      />
                    )}
                  />
                ))}
              </table>
            </div>
          </Card>
        )}

        {coverage.total > 0 && (
          <p className="mt-3 text-xs tabular-nums text-foreground-muted">
            {coverage.total} accounts in this view · {coverage.withDriver} with a driver defined ·{' '}
            {coverage.withoutDriver} not yet designed
            {coverage.dummy > 0 ? ` · ${coverage.dummy} placeholder` : ''}
          </p>
        )}

        <footer className="mt-6 border-t border-border-subtle pt-4">
          <p className="text-xs leading-5 text-foreground-muted">
            This page is read-only and shows only what is above. It stops working on{' '}
            {shareDate(view.expiresAt, now)}, or sooner if the link is turned off.
          </p>
        </footer>
      </div>
    </div>
  );
}

/** The five states, glossed once. The recipient has no legend anywhere else. */
function Legend() {
  const states = ['figure', 'input', 'zero', 'undefined', 'locked'] as const;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
      {states.map((state) => (
        <span
          key={state}
          className="flex items-center gap-1.5 text-[11px] text-foreground-muted"
        >
          <span
            className={cn(
              'grid size-5 place-items-center rounded-sm border text-[10px] font-semibold',
              STATE_TONE[state].line,
            )}
          >
            {STATE_GLYPH[state]}
          </span>
          {state}
        </span>
      ))}
    </div>
  );
}

function SectionBody({
  section,
  columns,
  open,
  onToggle,
  openCellId,
  onToggleCell,
  renderPanel,
}: {
  section: MatrixSection;
  columns: number;
  open: boolean;
  onToggle: () => void;
  openCellId: string | null;
  onToggleCell: (id: string) => void;
  renderPanel: (cell: FinishLineCell) => React.ReactNode;
}) {
  return (
    <tbody>
      <tr>
        <th
          colSpan={columns + 1}
          scope="colgroup"
          className="sticky left-0 border-y border-border-subtle bg-surface-2 p-0 text-left"
        >
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn(
                'size-4 shrink-0 text-foreground-muted transition-transform duration-150',
                open && 'rotate-90',
              )}
            />
            <span className="font-semibold text-foreground">{section.section.item}</span>
            {section.section.tag && (
              <span className="text-xs font-normal text-foreground-muted">
                {section.section.tag}
              </span>
            )}
          </button>
        </th>
      </tr>

      {open &&
        section.rows.map((row) => {
          const openHere = row.cells.find(
            (slot) => slot.cell && slot.cell.id === openCellId,
          )?.cell;
          return (
            <Fragment key={row.item.id}>
              <tr className="border-b border-border-subtle">
                <th
                  scope="row"
                  className={cn(
                    'sticky left-0 z-10 bg-card py-2 pr-3 text-left font-normal',
                    ROW_STYLE[row.item.style ?? 'plain'],
                  )}
                >
                  <span className="break-words">{row.item.item}</span>
                </th>
                {row.cells.map((slot) => {
                  const cell = slot.cell;
                  return (
                  <td key={slot.entity.code} className="px-3 py-2 text-right align-middle">
                    {cell ? (
                      <button
                        type="button"
                        aria-expanded={cell.id === openCellId}
                        // Three of the five glyphs are a single character and
                        // two are empty, so the glyph alone is not a name. The
                        // owner's matrix labels its cells the same way; a
                        // recipient on a screen reader must not meet a row of
                        // unnamed buttons.
                        aria-label={`${row.item.item}, ${slot.entity.label}, ${stateClauses(cell.state).label}`}
                        onClick={() => onToggleCell(cell.id)}
                        title={cell.note}
                        className={cn(
                          'inline-grid size-7 place-items-center rounded-sm text-[11px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          cell.id === openCellId
                            ? STATE_TONE[cell.state].cell
                            : STATE_TONE[cell.state].line,
                        )}
                      >
                        {STATE_GLYPH[cell.state]}
                      </button>
                    ) : (
                      <span className="text-foreground-muted" aria-hidden="true">
                        ·
                      </span>
                    )}
                  </td>
                  );
                })}
              </tr>
              {openHere && (
                <tr>
                  <td colSpan={columns + 1} className="p-0">
                    <div className="sticky left-0 w-[min(100%,calc(100vw-2rem))]">
                      {renderPanel(openHere)}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
    </tbody>
  );
}
