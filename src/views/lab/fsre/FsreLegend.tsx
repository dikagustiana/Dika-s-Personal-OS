/**
 * Legend under the building: each state as glyph + word + its colour. The
 * replay shows its agent and folder states (AGENT_LEGEND, FOLDER_LEGEND in
 * scene.ts); the synthetic office shows the five desk states (brief v2 §3).
 * The words come from statuses.ts, the glyphs and tones from glyphs.ts;
 * there is no second copy of either.
 */
import { DESK_GLYPHS, DESK_TONES } from '../../../logic/lab/fsre/glyphs';
import { AGENT_LEGEND, FOLDER_LEGEND } from '../../../logic/lab/fsre/scene';
import { DESK_STATES, DESK_STATE_WORDS } from '../../../logic/lab/fsre/statuses';
import { StatusBadge } from './fsreUi';

export function FsreLegend({ kind = 'replay' }: { kind?: 'replay' | 'office' }) {
  if (kind === 'office') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" aria-label="Legend">
        <span className="surface-label mr-1">Desks</span>
        {DESK_STATES.map((state) => (
          <StatusBadge key={state} glyph={DESK_GLYPHS[state]} word={DESK_STATE_WORDS[state]} tone={DESK_TONES[state]} />
        ))}
      </div>
    );
  }
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
