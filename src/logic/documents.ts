import type { ProjectDocument } from '../data/types';

/**
 * Document lists on projects and milestones.
 *
 * A document here is a link and a label — nothing else. The app stores no
 * binaries, sends no file anywhere, and the "upload" control in the UI is an
 * affordance over these two text fields. A dropped file only ever supplies
 * its filename as a default label; its contents are never read.
 */

/**
 * http(s) only.
 *
 * The stored URL is rendered into an `href`, so `javascript:` and `data:`
 * would be script injection through a text input. Anything that does not
 * parse, or that parses to another scheme, is rejected at the point of entry
 * rather than sanitized at the point of render.
 */
export function isSafeDocumentUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalizes a bare `drive.google.com/...` paste into a URL. Typing the
 * scheme is the single most common way this form gets rejected for no good
 * reason; a value that already carries any scheme is left exactly as typed so
 * a hostile one still fails `isSafeDocumentUrl`.
 */
export function normalizeDocumentUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Builds a document, or null when the input is not usable. The label falls
 * back to the URL's host + path so a link is never listed as a blank row.
 */
export function makeDocument(
  label: string,
  url: string,
  now: Date,
): ProjectDocument | null {
  const normalized = normalizeDocumentUrl(url);
  if (!isSafeDocumentUrl(normalized)) return null;
  const trimmedLabel = label.trim();
  return {
    label: trimmedLabel || fallbackLabel(normalized),
    url: normalized,
    addedAt: now.toISOString(),
  };
}

function fallbackLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : parsed.hostname;
  } catch {
    return url;
  }
}

/** Appends to a possibly-absent list without mutating it. */
export function appendDocument(
  documents: ProjectDocument[] | undefined,
  document: ProjectDocument,
): ProjectDocument[] {
  return [...(documents ?? []), document];
}

export function removeDocumentAt(
  documents: ProjectDocument[] | undefined,
  index: number,
): ProjectDocument[] {
  return (documents ?? []).filter((_, position) => position !== index);
}
