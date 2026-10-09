/**
 * The approval client over a scripted call: `preview` answers a result the
 * partner room can show (never a throw), `check` and `approve` keep throwing
 * on anything but the function's own answer (useMutation's toast owns those).
 */
import { describe, expect, it } from 'vitest';
import { createFsreApproval, previewResult, type FsreApproveCall } from './fsreApproval';

const PKG = { meta: { ticker: 'SYNP', version: 'SYNP-FY25-r1', provenance: 'filings' }, sheets: [] };
const STAGED = {
  ok: true,
  company: 'SYNP',
  version: 'SYNP-FY25-r1',
  wave_id: 'wave-live',
  status: 'staged',
  content_hash: 'a'.repeat(64),
  staged_at: '2026-10-08T10:00:00+00:00',
  package: PKG,
};

function scripted(answer: { status: number; body: unknown } | Error) {
  const asked: Parameters<FsreApproveCall>[0][] = [];
  const send: FsreApproveCall = async (body) => {
    asked.push(body);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { send, asked };
}

describe('previewResult', () => {
  it('reads a staged release, package included, into the building words', () => {
    expect(previewResult(200, STAGED)).toEqual({
      ok: true,
      preview: { company: 'SYNP', version: 'SYNP-FY25-r1', waveId: 'wave-live', status: 'staged', contentHash: 'a'.repeat(64), stagedAt: '2026-10-08T10:00:00+00:00', package: PKG },
    });
    expect(previewResult(200, { ...STAGED, status: 'published' })).toMatchObject({ ok: true, preview: { status: 'published' } });
  });

  it("is refused with the database's reasons for a withdrawn or unknown release", () => {
    expect(previewResult(200, { ok: false, reasons: ['no package v9 staged for SYNP'], company: 'SYNP', version: 'v9' })).toEqual({
      ok: false,
      reason: 'refused',
      detail: 'The database refused to show this package.',
      reasons: ['no package v9 staged for SYNP'],
    });
  });

  it.each([
    [404, { code: 'NOT_FOUND' }, 'not-connected', 'not deployed'],
    [500, { ok: false, reason: 'not-configured' }, 'not-connected', 'FSRE_APPROVER_DB_URL'],
    [401, { ok: false, reason: 'bad-key' }, 'failed', 'passphrase'],
    [502, { ok: false, reason: 'call-failed' }, 'failed', '502 (call-failed)'],
    [200, { ok: true, package: 'not an object' }, 'failed', 'shape'],
    [200, { ...STAGED, status: 'withdrawn' }, 'failed', 'shape'],
  ] as const)('says what the function answered: %i', (status, body, reason, words) => {
    const result = previewResult(status, body);
    expect(result).toMatchObject({ ok: false, reason, reasons: [] });
    expect(!result.ok && result.detail).toContain(words);
  });
});

describe('createFsreApproval', () => {
  it('sends each action with the company and version, and nothing else', async () => {
    const { send, asked } = scripted({ status: 200, body: { ok: true, reasons: [] } });
    const approval = createFsreApproval(send);
    await approval.check('SYNP', 'SYNP-FY25-r1');
    await approval.approve('SYNP', 'SYNP-FY25-r1');
    expect(asked).toEqual([
      { action: 'check', company: 'SYNP', version: 'SYNP-FY25-r1' },
      { action: 'approve', company: 'SYNP', version: 'SYNP-FY25-r1' },
    ]);
  });

  it('preview answers a result when the call throws; check still throws', async () => {
    const { send } = scripted(new Error('offline'));
    const approval = createFsreApproval(send);
    expect(await approval.preview('SYNP', 'v1')).toMatchObject({ ok: false, reason: 'failed', detail: 'The approval function could not be reached: offline' });
    await expect(approval.check('SYNP', 'v1')).rejects.toThrow('offline');
  });

  it('check and approve throw on anything but the function\'s own answer', async () => {
    const approval = createFsreApproval(scripted({ status: 404, body: { code: 'NOT_FOUND' } }).send);
    await expect(approval.check('SYNP', 'v1')).rejects.toThrow('the approval function answered 404');
    const refused = createFsreApproval(scripted({ status: 200, body: { ok: false, reasons: ['the company has no manifest approval'] } }).send);
    expect(await refused.approve('SYNP', 'v1')).toEqual({ ok: false, reasons: ['the company has no manifest approval'] });
  });
});
