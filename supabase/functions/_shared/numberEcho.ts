// The echo check: does this numeric value actually APPEAR in the text it
// was supposedly extracted from? This is the deterministic tether between
// an EXTRACTOR's output and its input — without it, the function writes
// whatever value the model returns, and a fabricated-but-plausible figure
// acquires a source citation it never had.
//
// DESIGN: the haystack is tokenized into numeric literals (en grouping, id
// grouping, space grouping, both decimal marks, trailing %), and each token
// is parsed under EVERY plausible locale reading. The value matches when it
// equals ANY reading of SOME token. Accepting all readings of a real token
// is sound — each corresponds to a legitimate way the text says a number —
// while a value matching NO reading of ANY token is exactly the fabrication
// this check exists to refuse.
//
// CONSERVATIVE BY CONSTRUCTION, per the review: scale words are NOT
// multiplied ("2,15 triliun" backs 2.15, never 2_150_000_000_000 — the
// scale belongs in the unit field); a false rejection costs a `skipped`
// line, a false acceptance costs the whole extraction guarantee. Pure TS,
// no Deno APIs, directly importable by vitest.

/**
 * Numeric literals as prose actually writes them: digit groups joined by
 * '.', ',' , space or NBSP, with an optional decimal tail and optional '%'.
 * Group-joined forms are matched first so "1 234" is one token, not two.
 */
const HAYSTACK_TOKEN =
  /\d{1,3}(?:[  .,]\d{3})+(?:[.,]\d+)?%?|\d+(?:[.,]\d+)?%?/g;

/**
 * Every plausible numeric reading of one token.
 *
 * en reading: ',' groups, '.' decimal.  id reading: '.' groups, ',' decimal.
 * Space/NBSP always group. A token like "1.234" is genuinely ambiguous
 * (en 1.234 / id 1234) and BOTH readings are returned; "1.234,56" is
 * unambiguous id; "1,234.56" unambiguous en; a malformed mix reads as
 * nothing.
 */
export function tokenReadings(rawToken: string): number[] {
  const token = rawToken.replace(/%$/, '').replace(/[  ]/g, '');
  const readings = new Set<number>();

  const tryReading = (groupSep: ',' | '.', decimalSep: ',' | '.') => {
    // The decimal separator may appear at most once, as the last separator,
    // and every group separator must delimit exactly 3 digits.
    const decimalIndex = token.lastIndexOf(decimalSep);
    const integerPart = decimalIndex === -1 ? token : token.slice(0, decimalIndex);
    const decimalPart = decimalIndex === -1 ? '' : token.slice(decimalIndex + 1);
    if (decimalPart.includes(groupSep) || decimalPart.includes(decimalSep)) return;
    const groups = integerPart.split(groupSep);
    if (groups.some((group) => group === '')) return;
    if (groups.length > 1) {
      if (groups[0].length > 3) return;
      if (groups.slice(1).some((group) => group.length !== 3)) return;
    }
    if (decimalIndex !== -1 && decimalPart === '') return;
    const canonical = groups.join('') + (decimalPart ? `.${decimalPart}` : '');
    const parsed = Number(canonical);
    if (Number.isFinite(parsed)) readings.add(parsed);
  };

  tryReading(',', '.'); // en: 1,234.56
  tryReading('.', ','); // id: 1.234,56
  return [...readings];
}

const relEquals = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * True when `value` appears in `haystack` as a numeric literal under some
 * legitimate locale reading. Negative values match a literal of their
 * magnitude immediately preceded by '-' or '(' (accounting negatives).
 * NO scale-word arithmetic, by design — see the header.
 */
export function numberAppearsIn(value: number, haystack: string): boolean {
  if (!Number.isFinite(value)) return false;
  const magnitude = Math.abs(value);
  for (const match of haystack.matchAll(HAYSTACK_TOKEN)) {
    for (const reading of tokenReadings(match[0])) {
      if (relEquals(reading, value)) return true;
      if (value < 0 && relEquals(reading, magnitude)) {
        const before = haystack.slice(Math.max(0, match.index - 1), match.index);
        if (before === '-' || before === '(') return true;
      }
    }
  }
  return false;
}
