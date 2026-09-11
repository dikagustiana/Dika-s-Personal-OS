// =============================================================================
// THE HOST PALETTE, IN A FORM THREE.JS CAN USE
// =============================================================================
//
// The HUD is CSS and resolves hsl(var(--token)) like every other surface in
// the app. The 3D world cannot: a THREE.Color and a canvas2d fillStyle are
// built before paint, in modules a test imports with no document, so they
// need literal values.
//
// So this is a MIRROR of src/index.css, not a second palette. Every entry
// is the exact hex that file's comment states for that token, and
// palette.test.ts re-derives each one from the HSL triplet in index.css and
// fails if they drift. The standalone build's own ramp (#37d2c6 teal,
// #ff5e6c, #ffb547, #62d889, #e9eef5 on #0f1420) is gone: it was a second
// design system living in the same repo, which is the thing the host config
// deletes Tailwind's default palette to prevent.
//
// WHAT IS DELIBERATELY NOT HERE. Sand, pavement, sky, sun, wall and desk
// colours are scene materials, lit by a directional light and graded by the
// time of day. They are a desert, not an interface, and running them
// through the Imperial ramp would make a worse desert and a worse ramp.
// Those live beside the geometry that uses them.

/** Semantic colours, mirrored from :root in src/index.css. */
export const HOST = {
  foreground: '#002147',
  foregroundSecondary: '#42596F',
  foregroundMuted: '#5E7185',
  surface1: '#FFFFFF',
  surface3: '#E9EEF2',
  border: '#C9D3DC',
  primary: '#003E74',
  primaryForeground: '#FFFFFF',
  success: '#4C7A00',
  destructive: '#C42200',
  escalate: '#9A5200',
  chart1: '#003E74',
  chart2: '#960078',
  chart3: '#9A5200',
  chart4: '#00728F',
} as const;

/** A label drawn over the scene: dark ink on a near-white plate. */
export const LABEL_INK = HOST.foreground;
export const LABEL_PLATE = 'rgba(255,255,255,0.82)';
/** A quieter plate for a name nobody is currently behind. */
export const LABEL_PLATE_QUIET = 'rgba(233,238,242,0.78)';
export const LABEL_INK_QUIET = HOST.foregroundMuted;

/** Badge roles. Text is always the badge's own foreground, never guessed. */
export const BADGE = {
  error: { background: HOST.destructive, text: '#FFFFFF' },
  warn: { background: HOST.escalate, text: '#FFFFFF' },
  info: { background: HOST.primary, text: '#FFFFFF' },
  muted: { background: HOST.foregroundMuted, text: '#FFFFFF' },
  ok: { background: HOST.success, text: '#FFFFFF' },
} as const;

/** The selection ring and anything else that means "this one". */
export const SELECTION = HOST.primary;

/**
 * The body tint of an avatar, by department.
 *
 * COLOUR IS A GROUPING HINT HERE, NOT AN IDENTIFIER. The host ramp has four
 * chart colours and the institution has ten rooms, so tints repeat — and
 * two of the four (chart-3 and chart-4) sit 1.06:1 apart in luminance, which
 * index.css already warns about. Which department someone is in is read off
 * the name plate above their head and the bay they are standing in; the tint
 * only helps the eye group a cluster at a glance. Inventing six more colours
 * to make the tint authoritative would put a second palette in the repo to
 * carry information the floor already shows twice.
 */
const SERIES = [HOST.chart1, HOST.chart2, HOST.chart3, HOST.chart4] as const;

export function departmentColor(slug: string | null | undefined): string {
  if (!slug) return HOST.foregroundMuted;
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SERIES[hash % SERIES.length];
}
