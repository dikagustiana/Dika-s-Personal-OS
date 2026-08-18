/**
 * The isometric workshop — a RENDERER only. Geometry, paint order, fills,
 * and the computed viewBox all come from buildFlowScene (pure, bounds-
 * tested); this file maps that data to SVG and wires focus and keyboard.
 *
 * Two rendering rules carried from the prototype's bugs:
 *  - the viewBox is NEVER hand-picked here — it arrives from the scene;
 *  - fonts are literal stacks in attributes: CSS custom properties fail
 *    silently in SVG presentation attributes.
 */
import { useMemo } from 'react';
import {
  buildFlowScene,
  FLOOR_EDGE,
  FLOOR_FILL,
  FLOOR_GRID,
  PATH_COLOR,
  type SceneStageInput,
} from '../../../logic/lab/flowScene';
import { agentColor } from '../../../logic/lab/labAgentColors';
import type { FlowStage } from '../../../logic/lab/labFlowState';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const points = (pts: ReadonlyArray<readonly [number, number]>): string =>
  pts.map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`).join(' ');

export function FlowFloorplan({
  stages,
  selectedIndex,
  onSelect,
}: {
  stages: FlowStage[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const scene = useMemo(() => {
    const inputs: SceneStageInput[] = stages.map((stage) => ({
      code: stage.code,
      actor: stage.actor,
      status: stage.status,
      running: stage.running,
      frontLine: stage.frontLine,
      // Callouts only where the brief says: front line, running, blocked.
      calloutLines:
        stage.running || stage.frontLine || stage.status === 'blocked'
          ? [
              `${stage.code} ${stage.title}${stage.running ? ' — berjalan' : stage.status === 'blocked' ? ' — terhalang' : ' — garis depan'}`,
              stage.blockers[0]?.reason ?? stage.headline,
            ]
          : [],
      tokens: stage.presentAgents.map((slug) => ({ slug, color: agentColor(slug) })),
    }));
    return buildFlowScene(inputs);
  }, [stages]);

  const byCode = new Map(stages.map((stage) => [stage.code, stage]));

  return (
    <svg
      viewBox={scene.viewBox}
      role="group"
      aria-label="Denah lantai pipeline — 13 stasiun"
      className="w-full"
    >
      <defs>
        {/* Hatch for blocked tops: barred, not hidden. */}
        <pattern id="flow-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="#3d4652" strokeWidth="2.2" opacity="0.4" />
        </pattern>
      </defs>

      {/* floor plate + tile grid */}
      <polygon points={points(scene.floor.outline)} fill={FLOOR_FILL} stroke={FLOOR_EDGE} strokeWidth="1.5" />
      {scene.floor.gridLines.map((line, index) => (
        <polyline key={`grid-${index}`} points={points(line)} fill="none" stroke={FLOOR_GRID} strokeWidth="0.6" />
      ))}

      {/* the path, segment by segment — a blocked middle must show */}
      {scene.segments.map((segment, index) => (
        <polyline
          key={`seg-${index}`}
          points={points(segment.points)}
          fill="none"
          stroke={PATH_COLOR[segment.state]}
          strokeWidth={segment.state === 'live' ? 2.6 : 2}
          strokeDasharray={segment.state === 'live' ? '7 5' : segment.state === 'ahead' ? '2 5' : undefined}
          strokeLinecap="round"
          className={segment.state === 'live' ? 'flow-march' : undefined}
        />
      ))}

      {/* plinths, painter-sorted, tokens bundled */}
      {scene.plinths.map((entry) => {
        const stage = byCode.get(entry.code)!;
        return (
          <g
            key={entry.code}
            role="button"
            tabIndex={0}
            aria-label={`${entry.code} ${stage.title} — ${stage.status}`}
            aria-pressed={selectedIndex === stage.index}
            className="flow-station cursor-pointer focus-visible:outline-none"
            onClick={() => onSelect(stage.index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(stage.index);
              }
            }}
          >
            <polygon points={points(entry.faces.left)} fill={entry.fills.left} />
            <polygon points={points(entry.faces.right)} fill={entry.fills.right} />
            <polygon
              points={points(entry.faces.top)}
              fill={entry.fills.top}
              stroke={selectedIndex === stage.index ? '#003E74' : 'rgba(15,23,42,0.25)'}
              strokeWidth={selectedIndex === stage.index ? 2.2 : 0.8}
              className={entry.running ? 'flow-pulse' : undefined}
            />
            {entry.hatched && <polygon points={points(entry.faces.top)} fill="url(#flow-hatch)" />}
            {/* The stage code sits on EVERY top face — always. */}
            <text
              x={entry.faces.topCenter[0]}
              y={entry.faces.topCenter[1] + 3.5}
              textAnchor="middle"
              fontFamily={MONO}
              fontSize="10"
              fontWeight="700"
              fill="#FFFFFF"
              pointerEvents="none"
            >
              {entry.code}
            </text>
            {entry.tokens.map((token) => (
              <g key={token.slug} className={stage.running ? 'flow-pulse' : undefined}>
                <title>{token.slug}</title>
                <polygon points={points(token.faces.left)} fill={token.color} opacity="0.78" />
                <polygon points={points(token.faces.right)} fill={token.color} opacity="0.6" />
                <polygon points={points(token.faces.top)} fill={token.color} stroke="rgba(255,255,255,0.7)" strokeWidth="0.8" />
              </g>
            ))}
          </g>
        );
      })}

      {/* callouts last, above everything */}
      {scene.callouts.map((callout) => (
        <g key={`callout-${callout.code}`} pointerEvents="none">
          <polyline points={points(callout.leader)} fill="none" stroke="#64748B" strokeWidth="1" strokeDasharray="2 3" />
          <rect
            x={callout.box.x}
            y={callout.box.y}
            width={callout.box.w}
            height={callout.box.h}
            rx="4"
            fill="#FFFFFF"
            stroke="#C9D4DE"
            strokeWidth="1"
          />
          {callout.lines.map((line, lineIndex) => (
            <text
              key={lineIndex}
              x={callout.box.x + 8}
              y={callout.box.y + 15 + lineIndex * 14}
              fontFamily={MONO}
              fontSize="10.5"
              fill={lineIndex === 0 ? '#1F2937' : '#5B6572'}
              fontWeight={lineIndex === 0 ? 700 : 400}
            >
              {line}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}
