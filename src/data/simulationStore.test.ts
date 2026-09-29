/**
 * The finish-line-simulation Edge Function, pinned two ways because it cannot
 * run under vitest (the provisionScope.test.ts technique):
 *
 *   1. The pure storage vocabulary it imports
 *      (supabase/functions/_shared/simulationStore.ts) is EXECUTED here —
 *      above all the absence rules, which decide the one fact the tab most
 *      needs: "never uploaded" (value: null) versus every way of failing to
 *      look.
 *   2. The function source is READ, and the invariants of its contract are
 *      asserted against its executable lines: the owner gate runs before the
 *      body or Storage is touched, a version is written without upsert and
 *      before the pointer, and nothing is ever deleted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SIMULATION_BUCKET,
  SIMULATION_POINTER,
  isStorageConflict,
  parsePointer,
  storageAbsence,
  versionPath,
} from '../../supabase/functions/_shared/simulationStore';

const SHA = 'ab12cd34'.padEnd(64, 'e');
const POINTER = {
  path: `versions/20260929T101500Z_${SHA.slice(0, 8)}.html`,
  sha256: SHA,
  bytes: 1_491_608,
  uploadedAt: '2026-09-29T10:15:00.000Z',
};

describe('versionPath', () => {
  it('stamps UTC to the second and appends the first eight hex of the digest', () => {
    expect(versionPath(new Date('2026-09-29T10:15:00.987Z'), SHA)).toBe(POINTER.path);
  });

  it('produces exactly the shape parsePointer accepts', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    const parsed = parsePointer({ ...POINTER, path: versionPath(at, SHA), uploadedAt: at.toISOString() });
    expect(parsed.ok).toBe(true);
  });
});

describe('parsePointer — a pointer that cannot say exactly what it points to is broken', () => {
  it('accepts the pointer the upload writes', () => {
    expect(parsePointer(POINTER)).toEqual({ ok: true, pointer: POINTER });
  });

  it.each([
    ['not an object', null],
    ['an array', [POINTER]],
    ['a path outside versions/', { ...POINTER, path: `../lab-artifacts/x_${SHA.slice(0, 8)}.html` }],
    ['a path with a sub-directory', { ...POINTER, path: `versions/a/20260929T101500Z_${SHA.slice(0, 8)}.html` }],
    ['a path whose digest disagrees', { ...POINTER, path: 'versions/20260929T101500Z_00000000.html' }],
    ['a short sha256', { ...POINTER, sha256: SHA.slice(0, 40) }],
    ['an upper-case sha256', { ...POINTER, sha256: SHA.toUpperCase() }],
    ['a zero byte count', { ...POINTER, bytes: 0 }],
    ['a fractional byte count', { ...POINTER, bytes: 1.5 }],
    ['a byte count as a string', { ...POINTER, bytes: '1491608' }],
    ['an unparseable date', { ...POINTER, uploadedAt: 'yesterday' }],
    ['a date that is not the upload’s own ISO form', { ...POINTER, uploadedAt: '2026-09-29' }],
    ['a missing field', { path: POINTER.path, sha256: SHA, bytes: 1 }],
  ])('refuses %s', (_label, raw) => {
    expect(parsePointer(raw).ok).toBe(false);
  });
});

describe('storageAbsence — the only door to "never uploaded"', () => {
  it('reads both not-found shapes as a missing object', () => {
    expect(storageAbsence(404, { statusCode: '404', error: 'not_found', message: 'Object not found' })).toBe('object');
    expect(storageAbsence(400, { statusCode: '404', error: 'not_found', message: 'Object not found' })).toBe('object');
    expect(storageAbsence(404, null)).toBe('object');
  });

  it('tells a missing bucket from a missing object', () => {
    expect(storageAbsence(400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' })).toBe('bucket');
    expect(storageAbsence(404, { error: 'Bucket not found' })).toBe('bucket');
  });

  it.each([
    [401, { statusCode: '401', error: 'Unauthorized', message: 'jwt expired' }],
    [403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }],
    [500, { statusCode: '500', error: 'internal', message: 'boom' }],
    [503, null],
    [400, { statusCode: '400', error: 'InvalidRequest', message: 'malformed key' }],
    [400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }],
  ])('never reads %s as an absence', (status, body) => {
    expect(storageAbsence(status, body)).toBeNull();
  });
});

describe('isStorageConflict', () => {
  it('recognises both conflict shapes', () => {
    expect(isStorageConflict(409, null)).toBe(true);
    expect(isStorageConflict(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })).toBe(true);
  });

  it('does not read other failures as a conflict', () => {
    expect(isStorageConflict(400, { statusCode: '404', message: 'Bucket not found' })).toBe(false);
    expect(isStorageConflict(500, { message: 'already exists' })).toBe(false);
  });
});

describe('the function source keeps its contract', () => {
  const source = readFileSync(
    join(__dirname, '../../supabase/functions/finish-line-simulation/index.ts'),
    'utf8',
  );
  /** Executable lines only — the comments name every forbidden thing on purpose. */
  const code = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');
  const serve = code.slice(code.indexOf('Deno.serve('));

  it('runs checkAppKey before reading the body or building the Storage client', () => {
    const gate = serve.indexOf('checkAppKey(request)');
    expect(gate).toBeGreaterThan(-1);
    expect(serve.indexOf('request.json()')).toBeGreaterThan(gate);
    expect(serve.indexOf('storage(url, serviceRole)')).toBeGreaterThan(gate);
    // Only the preflight and the method check come first.
    expect(serve.slice(0, gate)).not.toMatch(/store\.|handleRead|handleUpload/);
  });

  it('answers a failed gate with the gate’s own status and nothing else', () => {
    expect(serve).toMatch(/if \(!gate\.ok\) return json\([^\n]*gate\.status\);/);
  });

  it('knows exactly two actions: read and upload', () => {
    const actions = [...serve.matchAll(/body\.action === '([a-z-]+)'/g)].map((m) => m[1]);
    expect(actions).toEqual(['read', 'upload']);
  });

  it('writes the version without upsert, and the pointer (with upsert) only after it', () => {
    const upload = code.slice(code.indexOf('async function handleUpload'), code.indexOf('Deno.serve('));
    const versionWrite = upload.indexOf("store.put(path, bytes, 'text/html', false");
    const pointerWrite = upload.indexOf('store.put(\n    SIMULATION_POINTER');
    expect(versionWrite).toBeGreaterThan(-1);
    expect(pointerWrite).toBeGreaterThan(versionWrite);
    expect(upload.slice(pointerWrite, pointerWrite + 200)).toContain("'application/json',\n    true,");
    // A failed version write returns before the pointer is ever touched.
    expect(upload.slice(versionWrite, pointerWrite)).toMatch(/if \(!versionWrite\.ok\) \{[\s\S]*return failure/);
  });

  it('validates before touching Storage on upload', () => {
    const upload = code.slice(code.indexOf('async function handleUpload'), code.indexOf('Deno.serve('));
    expect(upload.indexOf('checkSimulationUpload(html)')).toBeLessThan(upload.indexOf('requireBucket(store)'));
  });

  it('never deletes, lists or overwrites a version', () => {
    expect(code).not.toMatch(/method: 'DELETE'|\/object\/list|\.remove\(|action === 'delete'|action === 'list'/);
    expect(code).toContain(SIMULATION_BUCKET === 'finish-line-simulation' ? 'SIMULATION_BUCKET' : '__never__');
    expect(SIMULATION_POINTER).toBe('current.json');
  });
});
