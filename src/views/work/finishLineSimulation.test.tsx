// @vitest-environment jsdom
/**
 * The Simulasi Hari-H tab, state by state, against a MockRepository whose two
 * simulation methods are spied — no partial fake, no cast.
 *
 * jsdom has no URL.createObjectURL and no Fullscreen API, so both are stubbed
 * per test; the real behaviour of a Blob document inside
 * sandbox="allow-scripts" (opaque origin, storage and parent blocked, parent
 * fullscreen working, a parent CSP inherited) was measured in Chromium and is
 * recorded in the component's comments, not asserted here.
 *
 * Fixtures are small synthetic HTML written inline.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIMULATION_MAX_BYTES,
  SIMULATION_WATERMARK,
} from '../../../supabase/functions/_shared/simulationUpload';
import type { FinishLineSimulation as Simulation } from '../../data/finishLineSimulation';
import { MockRepository } from '../../data/mockRepository';
import { useAppStore } from '../../store/appStore';
import { FinishLineSimulation } from './FinishLineSimulation';

const VALID_HTML = `<!doctype html><html><body><p>${SIMULATION_WATERMARK}</p></body></html>`;

const simulation = (sha8: string, bytes = 1_490_000): Simulation => ({
  html: `${VALID_HTML}<!-- ${sha8} -->`,
  meta: {
    path: `versions/20260929T101500Z_${sha8}.html`,
    sha256: sha8.padEnd(64, '0'),
    bytes,
    uploadedAt: '2026-09-29T10:15:00.000Z',
  },
});

let repository: MockRepository;
let blobCount = 0;
const createObjectURL = vi.fn(() => `blob:test/${++blobCount}`);
const revokeObjectURL = vi.fn();

function setup() {
  repository = new MockRepository();
  useAppStore.setState({ repository, viewer: { kind: 'owner' } });
  return {
    read: vi.spyOn(repository, 'readFinishLineSimulation'),
    upload: vi.spyOn(repository, 'uploadFinishLineSimulation'),
  };
}

const fileInput = () => screen.getByLabelText('File HTML simulasi') as HTMLInputElement;
function choose(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
}
const htmlFile = (content: string, name = 'simulasi.html') => new File([content], name, { type: 'text/html' });

beforeEach(() => {
  blobCount = 0;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('1. loading', () => {
  it('says it is checking, and shows nothing it does not have', () => {
    const { read } = setup();
    read.mockReturnValue(new Promise(() => {}));
    render(<FinishLineSimulation />);
    expect(screen.getByText('Memeriksa versi simulasi…')).toBeTruthy();
    expect(screen.queryByTitle(/Simulasi Hari-H/)).toBeNull();
    expect(screen.queryByText('Belum ada versi simulasi.')).toBeNull();
  });
});

describe('2. tidak bisa dicek', () => {
  it('names an undeployed function without pretending there is no version', async () => {
    const { read } = setup();
    read.mockResolvedValue({
      ok: false,
      reason: 'missing-relation',
      detail: 'readFinishLineSimulation: 404 — function finish-line-simulation belum di-deploy',
    });
    render(<FinishLineSimulation />);
    expect(await screen.findByText('Tidak bisa dicek')).toBeTruthy();
    expect(screen.getByText(/belum di-deploy/)).toBeTruthy();
    expect(screen.getByText(/Ini bukan tanda belum ada versi/)).toBeTruthy();
    expect(screen.queryByText('Belum ada versi simulasi.')).toBeNull();
    expect(screen.queryByTestId('simulation-meta')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('reports a broken pointer as a failed read, with its detail', async () => {
    const { read } = setup();
    read.mockResolvedValue({
      ok: false,
      reason: 'failed',
      detail: 'readFinishLineSimulation: 500 pointer-dangling — pointer rusak: gone',
    });
    render(<FinishLineSimulation />);
    expect(await screen.findByText('Tidak bisa dicek')).toBeTruthy();
    expect(screen.getByText(/pointer rusak/)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('retries on request', async () => {
    const { read } = setup();
    read.mockResolvedValue({ ok: false, reason: 'failed', detail: 'x' });
    render(<FinishLineSimulation />);
    fireEvent.click(await screen.findByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });
});

describe('3. belum ada versi', () => {
  it('shows the empty state and the upload control, and no frame', async () => {
    setup();
    render(<FinishLineSimulation />);
    expect(await screen.findByText('Belum ada versi simulasi.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pilih file HTML/ })).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('4. siap', () => {
  it('renders the frame from a Blob URL, with the version line and the key hint', async () => {
    const { read } = setup();
    read.mockResolvedValue({ ok: true, value: simulation('ab12cd34') });
    render(<FinishLineSimulation />);
    const frame = (await screen.findByTitle('Simulasi Hari-H — versi ab12cd34')) as HTMLIFrameElement;
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(frame.getAttribute('src')).toBe('blob:test/1');
    expect(frame.getAttribute('allow')).toBe('fullscreen');
    const meta = screen.getByTestId('simulation-meta').textContent ?? '';
    expect(meta).toContain('1,49 MB');
    expect(meta).toContain('ab12cd34');
    expect(meta.startsWith('Versi ')).toBe(true);
    expect(screen.getByText(/Klik area simulasi dulu, lalu pakai ← → Spasi 1–7 N F R T P A Esc\./)).toBeTruthy();
  });

  it('REGRESSION GUARD: the sandbox is exactly "allow-scripts"', async () => {
    // Adding allow-same-origin would let the simulation's script read this
    // app's sessionStorage — where the owner's x-app-key lives. Any other
    // token (popups, forms, modals, top-navigation) is a way out of the frame.
    const { read } = setup();
    read.mockResolvedValue({ ok: true, value: simulation('ab12cd34') });
    render(<FinishLineSimulation />);
    const frame = await screen.findByTitle(/Simulasi Hari-H/);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('fullscreens the FRAME from the parent, and says so when it cannot', async () => {
    const { read } = setup();
    read.mockResolvedValue({ ok: true, value: simulation('ab12cd34') });
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLIFrameElement.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    });
    render(<FinishLineSimulation />);
    const frame = await screen.findByTitle(/Simulasi Hari-H/);
    fireEvent.click(screen.getByRole('button', { name: 'Layar penuh' }));
    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));
    expect(requestFullscreen.mock.contexts[0]).toBe(frame);

    requestFullscreen.mockRejectedValueOnce(new TypeError('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Layar penuh' }));
    expect(await screen.findByText('Layar penuh tidak tersedia di browser ini.')).toBeTruthy();
  });

  it('revokes the Blob URL when the tab goes away', async () => {
    const { read } = setup();
    read.mockResolvedValue({ ok: true, value: simulation('ab12cd34') });
    const { unmount } = render(<FinishLineSimulation />);
    await screen.findByTitle(/Simulasi Hari-H/);
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });
});

describe('5. mengunggah, and what happens after', () => {
  it('disables the control while the upload is in flight', async () => {
    const { upload } = setup();
    upload.mockReturnValue(new Promise(() => {}));
    render(<FinishLineSimulation />);
    await screen.findByText('Belum ada versi simulasi.');
    choose(htmlFile(VALID_HTML));
    const button = await screen.findByRole('button', { name: /Mengunggah…/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(upload).toHaveBeenCalledWith(VALID_HTML);
  });

  it('re-reads after a successful upload and shows what the SERVER serves, revoking the old URL', async () => {
    const { read, upload } = setup();
    read
      .mockResolvedValueOnce({ ok: true, value: simulation('aaaa1111') })
      .mockResolvedValueOnce({ ok: true, value: simulation('bbbb2222') });
    upload.mockResolvedValue({ ok: true, meta: simulation('cccc3333').meta });
    render(<FinishLineSimulation />);
    await screen.findByTitle('Simulasi Hari-H — versi aaaa1111');
    choose(htmlFile(VALID_HTML));
    // The meta shown is the re-read's (bbbb2222) — never the upload's own
    // answer (cccc3333) and never the local file.
    expect(await screen.findByTitle('Simulasi Hari-H — versi bbbb2222')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/cccc3333/)).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });

  it('keeps nothing half-done when the upload throws: the control comes back', async () => {
    setup(); // the mock's own upload throws "tidak tersedia di mode mock"
    render(<FinishLineSimulation />);
    await screen.findByText('Belum ada versi simulasi.');
    choose(htmlFile(VALID_HTML));
    expect(await screen.findByRole('button', { name: /Pilih file HTML/ })).toBeTruthy();
    expect(screen.queryByTestId('upload-rejected')).toBeNull();
  });
});

describe('6. upload ditolak — every code and message', () => {
  it('refuses in the pre-flight without calling the server, listing all failures', async () => {
    const { upload } = setup();
    render(<FinishLineSimulation />);
    await screen.findByText('Belum ada versi simulasi.');
    choose(htmlFile('<!doctype html><a href="https://example.test">x</a>'));
    const panel = await screen.findByTestId('upload-rejected');
    expect(panel.textContent).toContain('SIM-WATERMARK');
    expect(panel.textContent).toContain('SIM-URL');
    expect(panel.textContent).toContain('2 pemeriksaan gagal');
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses an oversize file from its size alone', async () => {
    const { upload } = setup();
    render(<FinishLineSimulation />);
    await screen.findByText('Belum ada versi simulasi.');
    choose(new File([new Uint8Array(SIMULATION_MAX_BYTES + 1)], 'big.html', { type: 'text/html' }));
    const panel = await screen.findByTestId('upload-rejected');
    expect(panel.textContent).toContain('SIM-SIZE');
    expect(upload).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal the same way', async () => {
    const { upload } = setup();
    upload.mockResolvedValue({ ok: false, codes: ['SIM-NETAPI'], messages: ['File memanggil API: fetch(.'] });
    render(<FinishLineSimulation />);
    await screen.findByText('Belum ada versi simulasi.');
    choose(htmlFile(VALID_HTML));
    const panel = await screen.findByTestId('upload-rejected');
    expect(panel.textContent).toContain('SIM-NETAPI');
    expect(panel.textContent).toContain('File memanggil API: fetch(.');
  });
});

describe('7. offline', () => {
  it('says offline instead of could-not-check, and retries when the connection returns', async () => {
    const { read } = setup();
    read.mockResolvedValue({ ok: false, reason: 'failed', detail: 'readFinishLineSimulation: Failed to fetch' });
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    render(<FinishLineSimulation />);
    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Tidak bisa dicek')).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });
});
