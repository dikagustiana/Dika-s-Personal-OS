// The floorplan's two prototype bugs, pinned as tests:
//
//  §1 THE SCENE MUST NEVER OUTGROW ITS VIEWBOX. The prototype hand-picked a
//     viewBox and silently clipped the floor plate and the back-row
//     callouts. Here the viewBox is COMPUTED from sceneBounds(), and this
//     suite drives buildFlowScene through every state shape — all done,
//     all blocked (max callouts), running, token-crowded — asserting that
//     EVERY drawn element's points fall inside it. This is the reason
//     iso.ts and flowScene.ts are pure.
//
//  §2 The projection itself: px = (x−y)·T·cos30, py = (x+y)·T/2 − z, and
//     the painter's algorithm inputs (plinth faces share edges; deeper
//     stations sort later).
import { describe, expect, it } from 'vitest';
import { boundsToViewBox, iso, plinth, sceneBounds, shade, TILE } from './iso';
import {
  buildFlowScene,
  type FlowScene,
  type SceneStageInput,
} from './flowScene';
import { STAGES } from './labFlowState';

const COS30 = Math.cos(Math.PI / 6);

describe('§2 the projection', () => {
  it('projects the stated formula', () => {
    expect(iso(0, 0, 0)).toEqual([0, 0]);
    const [px, py] = iso(3, 1, 10);
    expect(px).toBeCloseTo((3 - 1) * TILE * COS30);
    expect(py).toBeCloseTo((3 + 1) * TILE * 0.5 - 10);
  });

  it('keeps a plinth watertight: faces share their corner points', () => {
    const faces = plinth(2, 3, 1.5, 1.5, 20);
    // top's front corner === left face's first corner === right face's first.
    expect(faces.left[1]).toEqual(faces.top[2]);
    expect(faces.right[0]).toEqual(faces.top[2]);
    // side faces reach the floor: z=0 means py grows by exactly h.
    expect(faces.left[2][1] - faces.left[1][1]).toBeCloseTo(20);
  });

  it('shade darkens toward black and clamps', () => {
    expect(shade('#ffffff', 0.5)).toBe('#808080');
    expect(shade('#9A5200', 1)).toBe('#9a5200');
    expect(shade('#9A5200', -4)).toBe('#000000');
  });

  it('sceneBounds covers every group and survives emptiness', () => {
    expect(sceneBounds([[-5, 2]], [[10, -3]])).toEqual({ minX: -5, minY: -3, maxX: 10, maxY: 2 });
    expect(sceneBounds()).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(boundsToViewBox({ minX: -10, minY: 0, maxX: 10, maxY: 5 }, 2)).toBe('-12 -2 24 9');
  });
});

// ---------------------------------------------------------------------------

function stageInputs(
  overrides: (index: number) => Partial<SceneStageInput> = () => ({}),
): SceneStageInput[] {
  return STAGES.map((def, index) => ({
    code: def.code,
    actor: def.actor,
    status: 'idle' as const,
    running: false,
    frontLine: false,
    calloutLines: [],
    tokens: [],
    ...overrides(index),
  }));
}

function everyDrawnPoint(scene: FlowScene): Array<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [...scene.floor.outline];
  for (const line of scene.floor.gridLines) points.push(...line);
  for (const segment of scene.segments) points.push(...segment.points);
  for (const entry of scene.plinths) {
    points.push(...entry.faces.top, ...entry.faces.left, ...entry.faces.right, entry.faces.topCenter);
    for (const token of entry.tokens) {
      points.push(...token.faces.top, ...token.faces.left, ...token.faces.right);
    }
  }
  for (const callout of scene.callouts) {
    points.push(...callout.leader);
    points.push([callout.box.x, callout.box.y]);
    points.push([callout.box.x + callout.box.w, callout.box.y + callout.box.h]);
  }
  return points;
}

function expectInsideViewBox(scene: FlowScene) {
  const [x, y, w, h] = scene.viewBox.split(' ').map(Number);
  for (const [px, py] of everyDrawnPoint(scene)) {
    expect(px).toBeGreaterThanOrEqual(x);
    expect(py).toBeGreaterThanOrEqual(y);
    expect(px).toBeLessThanOrEqual(x + w);
    expect(py).toBeLessThanOrEqual(y + h);
  }
}

describe('§1 every drawn element falls inside the computed viewBox', () => {
  it('holds for the empty pipeline', () => {
    expectInsideViewBox(buildFlowScene(stageInputs()));
  });

  it('holds with maximum callouts, long lines, and every station blocked', () => {
    const scene = buildFlowScene(
      stageInputs(() => ({
        status: 'blocked' as const,
        calloutLines: [
          'Terhalang — kontradiksi direct c-1234567890 dengan klaim yang sangat panjang sekali',
          'WIP cap: 25 datapoint terbuka di IND (cap 25) — verifikasi jalan majunya',
        ],
      })),
    );
    expect(scene.callouts).toHaveLength(13);
    expectInsideViewBox(scene);
  });

  it('holds with tokens crowding the agent stations and a run in flight', () => {
    const scene = buildFlowScene(
      stageInputs((index) => ({
        status: index < 6 ? ('done' as const) : ('attention' as const),
        running: index === 4,
        frontLine: index === 5,
        calloutLines: index === 4 || index === 5 ? [`S${index} sibuk`] : [],
        tokens:
          index === 2
            ? [
                { slug: 'evidence-scout', color: '#C2410C' },
                { slug: 'evidence-literature', color: '#0D9488' },
              ]
            : index === 4
              ? [{ slug: 'evidence-extractor', color: '#2563EB' }]
              : [],
      })),
    );
    expectInsideViewBox(scene);
  });
});

describe('the scene contract', () => {
  it('draws 13 plinths back-to-front and 12 path segments', () => {
    const scene = buildFlowScene(stageInputs());
    expect(scene.plinths).toHaveLength(13);
    expect(scene.segments).toHaveLength(12);
    // Painter order: the first drawn plinth is the shallowest (back row).
    const backRow = scene.plinths[0];
    const frontRow = scene.plinths[scene.plinths.length - 1];
    expect(['S0', 'S1', 'S2', 'S3', 'S4']).toContain(backRow.code);
    expect(['S9', 'S10', 'S11', 'S12']).toContain(frontRow.code);
  });

  it('refuses a wrong stage count — the pipeline is thirteen, counted', () => {
    expect(() => buildFlowScene(stageInputs().slice(0, 12))).toThrow(/13/);
  });

  it('marks segment state per segment: walked, live, ahead — a blocked middle shows', () => {
    const scene = buildFlowScene(
      stageInputs((index) => ({
        status: index <= 3 ? ('done' as const) : index === 4 ? ('blocked' as const) : ('idle' as const),
        running: index === 6,
      })),
    );
    expect(scene.segments[2].state).toBe('walked'); // into S3 (done)
    expect(scene.segments[3].state).toBe('ahead'); // into S4 — barred, not walked
    expect(scene.segments[5].state).toBe('live'); // into S6 — running
    expect(scene.segments[10].state).toBe('ahead');
  });

  it('S5 is the largest station on the floor — the hierarchy rule, literal', () => {
    const scene = buildFlowScene(stageInputs());
    const area = (code: string) => {
      const entry = scene.plinths.find((p) => p.code === code)!;
      const xs = entry.faces.top.map(([px]) => px);
      return Math.max(...xs) - Math.min(...xs);
    };
    for (const code of ['S0', 'S1', 'S2', 'S3', 'S4', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12']) {
      expect(area('S5')).toBeGreaterThan(area(code));
    }
  });

  it('tokens appear only where the caller placed them — no idle-agent crowd', () => {
    const scene = buildFlowScene(stageInputs());
    expect(scene.plinths.every((entry) => entry.tokens.length === 0)).toBe(true);
  });
});
