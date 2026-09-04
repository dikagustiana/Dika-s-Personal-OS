// Input validation for the scope actions of provision-collaborator —
// grant-scope and revoke-scope — kept PURE (no Deno API, no jsr import) so
// src/data/provisionScope.test.ts can execute it under vitest the way
// numberScan.ts and modelEval.ts are executed. The Edge Function imports it;
// the test suite imports it; there is one copy of the rules.
//
// WHAT A SCOPE REQUEST MAY SAY, AND NOTHING ELSE:
//   entityCode   one Finish line entity code (existence is checked against
//                os_finish_line_entities by the caller, which holds the client)
//   sectionIds   one or more os_finish_line_items ids; the caller checks each
//                one is kind = 'section', and the database trigger from
//                20260904000095 refuses anything else regardless
//   capability   exactly 'read' or 'write'. NO DEFAULT. A request that does
//                not say which is refused, because a default here would be a
//                permission decision taken by a fallback branch.
//
// THE ROLE IS NOT AN INPUT. Nothing in this module reads a `role`; the
// membership row a grant-scope may create is written with role =
// 'contributor', hardcoded in provision.ts, like every other enrolment.

export type ScopeCapability = 'read' | 'write';

/** One row of public.os_finish_line_grants, as the Edge Function reports it. */
export interface ScopeGrant {
  entityCode: string;
  sectionId: string;
  capability: ScopeCapability;
}

export interface GrantScopeInput {
  entityCode: string;
  /** De-duplicated, lower-cased, in request order. */
  sectionIds: string[];
  capability: ScopeCapability;
}

export interface RevokeScopeInput {
  entityCode: string;
  sectionId: string;
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entity codes are short upper-case tokens (SAMB, ARBI, KGR …). The bound
 *  is generous; the point is that a paragraph is not an entity code. */
const ENTITY_CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** More sections than this in one request is a client bug, not a grant. */
const MAX_SECTIONS = 200;

function parseEntityCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  return ENTITY_CODE_RE.test(code) ? code : null;
}

function parseCapability(raw: unknown): ScopeCapability | null {
  // Exact match, case-sensitive: 'Write', 'WRITE' and 'rw' are refused
  // rather than guessed at. The dashboard sends the literal it shows.
  return raw === 'read' || raw === 'write' ? raw : null;
}

export function parseGrantScope(
  rawEntityCode: unknown,
  rawSectionIds: unknown,
  rawCapability: unknown,
): ParseOutcome<GrantScopeInput> {
  const entityCode = parseEntityCode(rawEntityCode);
  if (!entityCode) return { ok: false, error: 'entityCode must be a single entity code' };
  if (!Array.isArray(rawSectionIds) || rawSectionIds.length === 0) {
    return { ok: false, error: 'sectionIds must be a non-empty array of section ids' };
  }
  if (rawSectionIds.length > MAX_SECTIONS) {
    return { ok: false, error: `sectionIds carries more than ${MAX_SECTIONS} ids` };
  }
  if (!rawSectionIds.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
    return { ok: false, error: 'sectionIds must be a non-empty array of section ids' };
  }
  const sectionIds = [...new Set((rawSectionIds as string[]).map((id) => id.toLowerCase()))];
  const capability = parseCapability(rawCapability);
  if (!capability) return { ok: false, error: "capability must be exactly 'read' or 'write'" };
  return { ok: true, value: { entityCode, sectionIds, capability } };
}

export function parseRevokeScope(
  rawEntityCode: unknown,
  rawSectionId: unknown,
): ParseOutcome<RevokeScopeInput> {
  const entityCode = parseEntityCode(rawEntityCode);
  if (!entityCode) return { ok: false, error: 'entityCode must be a single entity code' };
  if (typeof rawSectionId !== 'string' || !UUID_RE.test(rawSectionId)) {
    return { ok: false, error: 'sectionId must be a section id' };
  }
  return { ok: true, value: { entityCode, sectionId: rawSectionId.toLowerCase() } };
}

/** Stable order for the wire: by entity, then section, so two lists of the
 *  same grants compare equal and the dashboard's columns do not shuffle. */
export function sortScopeGrants(grants: ScopeGrant[]): ScopeGrant[] {
  return [...grants].sort((a, b) =>
    a.entityCode === b.entityCode
      ? a.sectionId.localeCompare(b.sectionId)
      : a.entityCode.localeCompare(b.entityCode),
  );
}
