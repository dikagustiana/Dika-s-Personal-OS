// The upload guards for the Finish line simulation, kept PURE — no Deno API,
// no jsr import — so the Edge Function (finish-line-simulation), the tab's
// pre-flight (FinishLineSimulation.tsx) and src/data/simulationUpload.test.ts
// all execute one copy of the rules. The server is the authority; the client
// runs the same function only to spare a ~1.5 MB round trip for a file that
// would be refused anyway.
//
// WHAT THESE GUARDS ARE, AND WHAT THEY ARE NOT. They are a tripwire for an
// accidental build — one that picked up a CDN link, an analytics snippet or a
// storage call on its way out of the simulation repo. They are NOT the
// containment boundary: a string scan cannot see `window['fe' + 'tch']`. The
// boundary is the iframe sandbox in FinishLineSimulation.tsx (opaque origin,
// no storage, no parent access). A build that trips a guard is fixed in the
// build; the guard is not loosened to let it through.
//
// EVERY failing guard is reported, never just the first, so one round shows
// everything wrong with a file instead of one refusal per upload. The messages
// are user-facing copy and follow the tab's language.

export type SimulationGuardCode =
  | 'SIM-SIZE'
  | 'SIM-EMPTY'
  | 'SIM-DOCTYPE'
  | 'SIM-WATERMARK'
  | 'SIM-URL'
  | 'SIM-NETAPI';

/** Report order, fixed so two refusals of the same file compare equal. */
export const SIMULATION_GUARD_CODES: readonly SimulationGuardCode[] = [
  'SIM-SIZE',
  'SIM-EMPTY',
  'SIM-DOCTYPE',
  'SIM-WATERMARK',
  'SIM-URL',
  'SIM-NETAPI',
];

export interface SimulationGuardFailure {
  code: SimulationGuardCode;
  message: string;
}

export type SimulationUploadCheck =
  | { ok: true; bytes: number }
  | { ok: false; bytes: number; failures: SimulationGuardFailure[] };

/**
 * 3 MiB, in UTF-8 BYTES — not characters. The same number is the bucket's
 * file_size_limit (20260928000108), so the function and Storage refuse at the
 * same line and neither can be the one that quietly lets a file through.
 */
export const SIMULATION_MAX_BYTES = 3_145_728;

/** Exact string, em dash U+2014 — a hyphen or an en dash is not the mark. */
export const SIMULATION_WATERMARK = 'SIMULATION \u2014 illustrative figures';

/** Optional BOM and leading whitespace, then the doctype, any case. */
const DOCTYPE_RE = /^\uFEFF?\s*<!doctype html/i;

/** Any absolute http(s) address, any case. */
const URL_SCHEME_RE = /https?:\/\//gi;

/**
 * The browser APIs that reach past the file: persistent storage and the
 * network. `\b` keeps `prefetch(` and `fetchAll` from reading as `fetch(`.
 */
const NET_APIS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { name: 'fetch(', pattern: /\bfetch\s*\(/ },
];

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * The SIM-SIZE failure for a byte count. Exported so the tab can refuse an
 * oversize file from its File.size alone, before reading megabytes into
 * memory; checkSimulationUpload uses the same function, so the sentence is
 * one sentence wherever it is shown.
 */
export function simulationSizeFailure(bytes: number): SimulationGuardFailure {
  return {
    code: 'SIM-SIZE',
    message: `Ukuran file ${bytes.toLocaleString('id-ID')} byte, melebihi batas ${SIMULATION_MAX_BYTES.toLocaleString('id-ID')} byte (3 MB).`,
  };
}

export function isSimulationGuardCode(value: unknown): value is SimulationGuardCode {
  return typeof value === 'string' && (SIMULATION_GUARD_CODES as readonly string[]).includes(value);
}

export function checkSimulationUpload(html: string): SimulationUploadCheck {
  const bytes = utf8ByteLength(html);
  const failures: SimulationGuardFailure[] = [];

  if (bytes > SIMULATION_MAX_BYTES) failures.push(simulationSizeFailure(bytes));
  // Every guard below still runs on an empty file, on purpose: an empty
  // string also has no doctype and no watermark, and saying so is true. The
  // floor test pins that SIM-EMPTY is among them, so a validator that stopped
  // looking cannot read as one that approved.
  if (html.trim() === '') {
    failures.push({ code: 'SIM-EMPTY', message: 'File kosong.' });
  }
  if (!DOCTYPE_RE.test(html)) {
    failures.push({
      code: 'SIM-DOCTYPE',
      message: 'File harus diawali <!doctype html> (boleh didahului BOM atau spasi).',
    });
  }
  if (!html.includes(SIMULATION_WATERMARK)) {
    failures.push({
      code: 'SIM-WATERMARK',
      message: `Watermark "${SIMULATION_WATERMARK}" tidak ditemukan (persis, dengan em dash).`,
    });
  }
  const urls = html.match(URL_SCHEME_RE)?.length ?? 0;
  if (urls > 0) {
    failures.push({
      code: 'SIM-URL',
      message: `File memuat ${urls} alamat http:// atau https://. Simulasi harus berjalan tanpa jaringan.`,
    });
  }
  const apis = NET_APIS.filter((api) => api.pattern.test(html)).map((api) => api.name);
  if (apis.length > 0) {
    failures.push({
      code: 'SIM-NETAPI',
      message: `File memanggil API penyimpanan atau jaringan: ${apis.join(', ')}.`,
    });
  }

  return failures.length === 0 ? { ok: true, bytes } : { ok: false, bytes, failures };
}
