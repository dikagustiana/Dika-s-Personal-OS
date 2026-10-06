/**
 * One cutaway floor: the SVG drawing, the wall screens, the chips and the
 * real buttons laid over it. Everything here comes finished from
 * buildFloorScene (src/logic/lab/fsre/scene.ts): this component maps scene
 * items to elements and does no arithmetic, holds no number literal and
 * names no colour — the drawing is coloured by index.css classes.
 */
import { FLOOR_ASPECT_RATIO, FLOOR_SVG, STAGE_SCREEN } from '../../../logic/lab/fsre/geometry';
import type { BoxFaces } from '../../../logic/lab/fsre/projection';
import type { ChipSpec, DrawItem, FloorScene, FsreSelection, HitSpec, WallSpec } from '../../../logic/lab/fsre/scene';
import type { Touched } from '../../../logic/lab/fsre/scene';
import { Glyph } from './fsreUi';

interface FsreFloorProps {
  scene: FloorScene;
  onSelect: (selection: FsreSelection) => void;
  /** What the last applied event moved; empty when nothing should move. */
  touched: Touched;
  /** Restarts the flash for each new event. */
  motionKey: string;
}

function Faces({ faces, material }: { faces: BoxFaces; material: string }) {
  return (
    <g>
      <polygon points={faces.top} className="fsre-face fsre-top" data-material={material} />
      <polygon points={faces.side} className="fsre-face fsre-side" data-material={material} />
      <polygon points={faces.front} className="fsre-face fsre-front" data-material={material} />
    </g>
  );
}

function Item({ item, arriving }: { item: DrawItem; arriving: boolean }) {
  switch (item.kind) {
    case 'box':
      return <Faces faces={item.faces} material={item.material} />;
    case 'rack':
      return (
        <g>
          <polygon points={item.faces.top} className="fsre-rack-top" />
          <polygon points={item.faces.side} className="fsre-rack-side" />
          <polygon points={item.faces.front} className="fsre-rack-front" />
          {item.slats.map((slat) => (
            <line key={`${slat.y1}`} x1={slat.x1} y1={slat.y1} x2={slat.x2} y2={slat.y2} className="fsre-rack-slat" />
          ))}
        </g>
      );
    case 'agent':
      return (
        <g>
          <ellipse cx={item.shape.shadow.cx} cy={item.shape.shadow.cy} rx={item.shape.shadow.rx} ry={item.shape.shadow.ry} className="fsre-shadow" />
          <rect
            x={item.shape.body.x}
            y={item.shape.body.y}
            width={item.shape.body.width}
            height={item.shape.body.height}
            rx={item.shape.body.rx}
            className="fsre-agent-body"
            data-status={item.status}
          />
          <circle cx={item.shape.head.cx} cy={item.shape.head.cy} r={item.shape.head.r} className="fsre-head" />
        </g>
      );
    case 'plant':
      return (
        <g>
          <polygon points={item.shape.pot.top} className="fsre-plant-pot" />
          <polygon points={item.shape.pot.side} className="fsre-plant-pot" />
          <polygon points={item.shape.pot.front} className="fsre-plant-pot" />
          {item.shape.crowns.map((crown) => (
            <circle key={`${crown.cx}:${crown.cy}`} cx={crown.cx} cy={crown.cy} r={crown.r} className="fsre-plant-leaf" />
          ))}
        </g>
      );
    case 'glass':
      return (
        <g>
          {item.polygons.map((points) => (
            <polygon key={points} points={points} className="fsre-glass" />
          ))}
        </g>
      );
    case 'folders':
      return (
        <g className={arriving ? 'fsre-arrive' : undefined}>
          {item.boxes.map((faces) => (
            <Faces key={faces.top} faces={faces} material="folder" />
          ))}
        </g>
      );
    case 'pile':
      return (
        <g>
          {item.sheets.map((faces) => (
            <Faces key={faces.top} faces={faces} material={`doc-${item.pile}`} />
          ))}
        </g>
      );
  }
}

function Wall({ wall }: { wall: WallSpec }) {
  const body = wall.body;
  if (body.content === 'lift') {
    return (
      <g>
        <polygon points={wall.frame} className="fsre-lift-frame" />
        {body.doors.map((door) => (
          <polygon key={door} points={door} className="fsre-lift-door" />
        ))}
      </g>
    );
  }
  return (
    <g>
      <polygon points={wall.frame} className="fsre-wall-frame" />
      <polygon points={wall.screen} className="fsre-wall-screen" />
    </g>
  );
}

function WallText({ wall }: { wall: WallSpec }) {
  const body = wall.body;
  const box = { left: wall.rect.left, top: wall.rect.top, width: wall.rect.width, height: wall.rect.height };
  switch (body.content) {
    case 'stages':
      return (
        <div className="fsre-wall" style={box} aria-label="Stage screen">
          <ol className="fsre-stage-grid" style={{ ['--fsre-columns' as string]: STAGE_SCREEN.columns }}>
            {body.cells.map((cell) => (
              <li key={cell.stageId} className="fsre-stage-cell fsre-tone" data-tone={cell.tone} title={`${cell.name}: ${cell.word}`}>
                <span aria-hidden="true">{cell.glyph}</span>
                <span className="sr-only">{cell.name}: </span>
                {cell.word}
              </li>
            ))}
          </ol>
        </div>
      );
    case 'figures':
      return (
        <div className="fsre-wall flex items-center justify-around px-1" style={box} aria-label="Data room counter">
          {body.entries.length ? (
            body.entries.map((entry) => (
              <div key={entry.key} className="text-center">
                <div className="font-semibold tabular-nums">{entry.value}</div>
                <div className="text-foreground-muted">{entry.label}</div>
              </div>
            ))
          ) : (
            <span className="text-foreground-muted">No figures yet</span>
          )}
        </div>
      );
    case 'issues':
      return (
        <div className="fsre-wall px-1 py-0.5" style={box} aria-label="Open issues board">
          <div className="font-semibold">Open issues</div>
          {body.entries.length ? (
            <ul>
              {body.entries.map((entry) => (
                <li key={entry.key} className="truncate">
                  <Glyph glyph={entry.glyph} tone={entry.tone} /> {entry.word} · {entry.subject} · {entry.title}
                </li>
              ))}
              {body.more ? <li className="text-foreground-muted">{body.more}</li> : null}
            </ul>
          ) : (
            <div className="text-foreground-muted">None open</div>
          )}
        </div>
      );
    default:
      return null;
  }
}

function Chip({ chip, flash, motionKey }: { chip: ChipSpec; flash: boolean; motionKey: string }) {
  return (
    <div
      key={flash ? `${chip.id}:${motionKey}` : chip.id}
      className={flash ? 'fsre-chip fsre-flash' : 'fsre-chip'}
      data-chip={chip.id}
      data-tone={chip.tone}
      data-stagger={chip.stagger}
      data-strong={chip.strong}
      data-dim={chip.dim ? 'true' : undefined}
      data-lead={chip.lead ? 'true' : undefined}
      style={chip.anchor}
    >
      {chip.glyph ? <Glyph glyph={chip.glyph} tone={chip.tone} /> : null} {chip.text}
      {chip.detail?.map((line) => (
        <span key={line} className="fsre-chip-detail">
          {line}
        </span>
      ))}
    </div>
  );
}

function Hit({ hit, onSelect }: { hit: HitSpec; onSelect: (selection: FsreSelection) => void }) {
  return (
    <button
      type="button"
      className="fsre-hit"
      aria-label={hit.label}
      aria-pressed={hit.selected}
      onClick={() => onSelect(hit.selection)}
      style={{ left: hit.rect.left, top: hit.rect.top, width: hit.rect.width, height: hit.rect.height }}
    />
  );
}

export function FsreFloor({ scene, onSelect, touched, motionKey }: FsreFloorProps) {
  const [tagLabel, ...tagParts] = scene.tag;
  return (
    <div className="fsre-floor" style={{ aspectRatio: FLOOR_ASPECT_RATIO }} data-floor={scene.floorId}>
      <svg viewBox={`0 0 ${FLOOR_SVG.width} ${FLOOR_SVG.height}`} role="img" aria-label={scene.label}>
        <polygon points={scene.shell.slab} className="fsre-slab" />
        <polygon points={scene.shell.ground} className="fsre-ground" />
        <polygon points={scene.shell.back} className="fsre-wall-back" />
        {scene.shell.sides.map((points) => (
          <polygon key={points} points={points} className="fsre-wall-side" />
        ))}
        {scene.walls.map((wall) => (
          <Wall key={wall.id} wall={wall} />
        ))}
        {scene.items.map((item) => (
          <g
            key={item.kind === 'folders' && touched.arrivals.has(item.deskKey) ? `${item.key}:${motionKey}` : item.key}
            className={(item.kind === 'box' || item.kind === 'agent') && item.dim ? 'fsre-dim' : undefined}
          >
            <Item item={item} arriving={item.kind === 'folders' && touched.arrivals.has(item.deskKey)} />
          </g>
        ))}
        {scene.ring ? <polygon points={scene.ring} className="fsre-ring" /> : null}
      </svg>

      {scene.walls.map((wall) => (
        <WallText key={wall.id} wall={wall} />
      ))}

      <div aria-hidden="true">
        {scene.chips.map((chip) => (
          <Chip key={chip.id} chip={chip} flash={touched.chips.has(chip.id)} motionKey={motionKey} />
        ))}
        <div className="fsre-floor-tag">
          <strong className="text-foreground">{tagLabel}</strong>
          {tagParts.length ? `, ${tagParts.join(', ')}` : ''}
        </div>
      </div>

      {scene.hits.map((hit) => (
        <Hit key={hit.id} hit={hit} onSelect={onSelect} />
      ))}
    </div>
  );
}
