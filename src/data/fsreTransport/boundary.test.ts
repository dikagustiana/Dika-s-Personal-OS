/**
 * The building talks only to FsreTransport (brief v2 §3; v2.1 FX-5): no
 * file outside src/data/fsreTransport/ may import a mock transport module.
 * The factory (index.ts), the MockControls guard (controls.ts), the contract
 * and the provisional names are the transport's public face and may be
 * imported. Ported from the GLM workspace (src/transport/boundary.test.ts at
 * 5b5d186), widened to the whole app.
 */
import { describe, expect, it } from 'vitest';
import { hasMockControls } from './controls';
import { createTransport } from './index';

const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('the transport boundary (FX-5)', () => {
  it('no file outside the transport imports a mock module', () => {
    // The scan reads the building's own files (a glob that matched nothing would pass vacuously).
    expect(Object.keys(sources).some((path) => path.endsWith('/views/lab/fsre/FsreOffice.tsx'))).toBe(true);
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.startsWith('/src/data/fsreTransport/') && !/\.test\.(ts|tsx)$/.test(path))
      .filter(([, text]) => /fsreTransport\/mock/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('the factory gives the stub for Live, which has no mock controls and is not wired', async () => {
    const stub = createTransport('live');
    expect(hasMockControls(stub)).toBe(false);
    await expect(stub.listAgents()).rejects.toThrow('Not wired yet');
  });
});
