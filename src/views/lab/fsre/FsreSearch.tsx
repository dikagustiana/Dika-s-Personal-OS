/**
 * Search by ticker, company name, skill or stage. A combobox: type to
 * filter, arrow keys to move, Enter to choose. Choosing a company selects
 * its folder BY TICKER, wherever it rests; the text also filters the
 * company list in the details panel (the same query, one store).
 */
import { useId, useMemo, useState } from 'react';
import { Input } from '../../../components/ui/Input';
import type { FsreContext, FsreState } from '../../../logic/lab/fsre/reducer';
import type { FsreSelection } from '../../../logic/lab/fsre/scene';
import { FIRST_RESULT, moveActive, searchResults, selectionForResult, type SearchResult } from '../../../logic/lab/fsre/search';
import { cn } from '../../../lib/utils';

interface FsreSearchProps {
  ctx: FsreContext | null;
  state: FsreState | null;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (selection: FsreSelection) => void;
  onHighlightStage: (stageId: string | null) => void;
}

export function FsreSearch({ ctx, state, query, onQuery, onSelect, onHighlightStage }: FsreSearchProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(FIRST_RESULT);
  const listId = useId();
  const hintId = useId();

  const results = useMemo(() => (ctx && state ? searchResults(ctx, state, query) : []), [ctx, state, query]);
  const expanded = open && results.length > FIRST_RESULT;

  const choose = (result: SearchResult) => {
    if (!ctx) return;
    onSelect(selectionForResult(ctx, result));
    onHighlightStage(result.type === 'stage' ? result.id : null);
    setOpen(false);
  };

  return (
    <div className="relative w-full sm:w-64">
      <Input
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={hintId}
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        aria-label="Search by ticker, company, skill or stage"
        placeholder="Search ticker, skill or stage"
        disabled={!ctx}
        value={query}
        className="h-11"
        onChange={(event) => {
          onQuery(event.target.value);
          setOpen(true);
          setActive(FIRST_RESULT);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((index) => moveActive(index, 'next', results.length));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => moveActive(index, 'previous', results.length));
          } else if (event.key === 'Enter') {
            const result = results[active];
            if (expanded && result) {
              event.preventDefault();
              choose(result);
            }
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <span id={hintId} className="sr-only">
        Use the arrow keys to move through the results and Enter to choose one.
      </span>
      {expanded ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-md border border-border bg-card shadow-card"
        >
          {results.map((result, index) => (
            <li
              key={`${result.type}:${result.id}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm text-foreground',
                index === active ? 'bg-surface-3' : 'hover:bg-surface-2',
              )}
              onMouseDown={(event) => {
                // Before the input's blur closes the list.
                event.preventDefault();
                choose(result);
              }}
            >
              <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-foreground-secondary">{result.typeWord}</span>
              {result.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
