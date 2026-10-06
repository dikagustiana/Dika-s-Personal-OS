/**
 * Legend under the building: each agent state and each folder state as
 * glyph + word + its colour. The lists come from statuses.ts and glyphs.ts
 * (AGENT_LEGEND, FOLDER_LEGEND); there is no second copy of the words.
 */
import { AGENT_LEGEND, FOLDER_LEGEND } from '../../../logic/lab/fsre/scene';
import { StatusBadge } from './fsreUi';

export function FsreLegend() {
  return (
    <div className="mt-3 space-y-2 text-sm" aria-label="Legend">
      <div className="flex flex-wrap items-center gap-2">
        <span className="surface-label mr-1">Agents</span>
        {AGENT_LEGEND.map((entry) => (
          <StatusBadge key={entry.status} glyph={entry.glyph} word={entry.word} tone={entry.tone} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="surface-label mr-1">Folders</span>
        {FOLDER_LEGEND.map((entry) => (
          <StatusBadge key={entry.status} glyph={entry.glyph} word={entry.word} tone={entry.tone} />
        ))}
      </div>
    </div>
  );
}
