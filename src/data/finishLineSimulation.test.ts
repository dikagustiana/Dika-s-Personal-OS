/**
 * The simulation read and upload as the repository sees them.
 *
 * The classifiers are pure, so the rule the tab rests on is executed here
 * directly: `value: null` comes back ONLY for an explicit "never uploaded",
 * and every other answer — the gateway's 404 for an undeployed function, a
 * missing bucket, a broken pointer, a malformed body — is a failure with a
 * reason. No test in this repo stubs the Supabase env, so the fetch wiring
 * itself stays thin; what is pinned here is what it means.
 */
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifySimulationRead,
  classifySimulationUpload,
  simulationOwnerOnly,
} from './finishLineSimulation';
import { MockRepository } from './mockRepository';
import { createSupabaseRepositoryForClient } from './supabaseRepository';

const META = {
  path: 'versions/20260929T101500Z_ab12cd34.html',
  sha256: 'ab12cd34'.padEnd(64, 'e'),
  bytes: 2048,
  uploadedAt: '2026-09-29T10:15:00.000Z',
};
const HTML = '<!doctype html><p>synthetic</p>';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifySimulationRead — three outcomes, never two', () => {
  it('returns value: null only for an explicit "never uploaded"', () => {
    expect(classifySimulationRead(200, { ok: true, value: null })).toEqual({ ok: true, value: null });
  });

  it('returns the simulation when the body carries one', () => {
    expect(classifySimulationRead(200, { ok: true, value: { html: HTML, meta: META } })).toEqual({
      ok: true,
      value: { html: HTML, meta: META },
    });
  });

  it('reads the gateway 404 of an undeployed function as a failure, NOT as null', () => {
    const result = classifySimulationRead(404, { code: 'NOT_FOUND', message: 'Requested function was not found' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-relation');
    expect(result.detail).toContain('belum di-deploy');
  });

  it('reads a missing bucket as missing-relation — a migration not applied yet', () => {
    const result = classifySimulationRead(500, { ok: false, reason: 'bucket-missing', message: 'no bucket' });
    expect(result).toMatchObject({ ok: false, reason: 'missing-relation' });
  });

  it.each(['pointer-dangling', 'pointer-malformed', 'pointer-mismatch'])(
    'reads %s as a broken pointer (failed), never as the empty state',
    (reason) => {
      const result = classifySimulationRead(500, { ok: false, reason, message: 'x' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('failed');
      expect(result.detail).toContain('pointer rusak');
    },
  );

  it.each([
    ['a body with no value key at all', 200, { ok: true }],
    ['a value that is not a simulation', 200, { ok: true, value: { html: 42 } }],
    ['ok: false with a 200', 200, { ok: false }],
    ['an unparseable body', 200, null],
    ['the owner gate', 401, { ok: false, error: 'Unauthorized' }],
    ['a lockout', 429, { ok: false, error: 'Locked out', retryAfter: 90 }],
    ['a storage failure', 500, { ok: false, reason: 'storage-error', message: 'boom' }],
    ['a platform resource limit', 546, null],
  ])('is a failure, not null, for %s', (_label, status, body) => {
    const result = classifySimulationRead(status, body);
    expect(result.ok).toBe(false);
  });

  it('keeps the retry hint of a lockout in the detail', () => {
    const result = classifySimulationRead(429, { ok: false, error: 'Locked out', retryAfter: 90 });
    expect(result.ok ? '' : result.detail).toContain('90 detik');
  });
});

describe('classifySimulationUpload — a refusal is data, everything else throws', () => {
  it('returns the meta of a stored version', () => {
    expect(classifySimulationUpload(200, { ok: true, value: { meta: META } })).toEqual({ ok: true, meta: META });
  });

  it('returns every refused code and message as data', () => {
    expect(
      classifySimulationUpload(422, {
        ok: false,
        codes: ['SIM-URL', 'SIM-WATERMARK'],
        messages: ['a', 'b'],
      }),
    ).toEqual({ ok: false, codes: ['SIM-URL', 'SIM-WATERMARK'], messages: ['a', 'b'] });
  });

  it.each([
    ['an undeployed function', 404, { code: 'NOT_FOUND' }, /belum di-deploy/],
    ['a missing bucket', 500, { ok: false, reason: 'bucket-missing', message: 'no bucket' }, /bucket-missing/],
    ['an existing version', 409, { ok: false, reason: 'version-exists', message: 'exists' }, /version-exists/],
    ['a pointer that did not move', 500, { ok: false, reason: 'pointer-write-failed', message: 'x' }, /pointer-write-failed/],
    ['the owner gate', 401, { ok: false, error: 'Unauthorized' }, /401/],
    ['a 422 carrying no known code', 422, { ok: false, codes: ['SIM-NOPE'], messages: ['x'] }, /422/],
  ])('throws for %s', (_label, status, body, pattern) => {
    expect(() => classifySimulationUpload(status, body)).toThrow(pattern);
  });
});

describe('owner only — a repository without the owner key sends nothing', () => {
  // A real client pointed nowhere: constructing it makes no request, and the
  // repository never gets as far as using it.
  const keyless = () =>
    createSupabaseRepositoryForClient(
      createClient('http://127.0.0.1:9', 'test-anon-key', { auth: { persistSession: false } }),
    );

  it('answers the read owner-only without a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(keyless().readFinishLineSimulation()).resolves.toEqual(simulationOwnerOnly());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses the upload without a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(keyless().uploadFinishLineSimulation(HTML)).rejects.toThrow(/hanya untuk owner/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the mock', () => {
  it('carries no simulation: the owner reads the honest empty state', async () => {
    await expect(new MockRepository().readFinishLineSimulation()).resolves.toEqual({ ok: true, value: null });
  });

  it('answers a contributor owner-only, like the Supabase path', async () => {
    const repo = new MockRepository();
    repo.setViewer({ kind: 'contributor', userId: 'u1', entityCodes: ['ENT1'] });
    await expect(repo.readFinishLineSimulation()).resolves.toEqual(simulationOwnerOnly());
  });

  it('refuses uploads in mock mode', async () => {
    await expect(new MockRepository().uploadFinishLineSimulation(HTML)).rejects.toThrow(
      'Upload simulasi tidak tersedia di mode mock.',
    );
  });
});
