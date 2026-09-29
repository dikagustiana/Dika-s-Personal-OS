/**
 * The Finish line simulation's upload guards, EXECUTED — the pure module in
 * supabase/functions/_shared/simulationUpload.ts is the one the Edge Function
 * and the tab's pre-flight both import, so these cases pin the server's rules
 * and the client's at once.
 *
 * Fixtures are small synthetic HTML written inline. No build output from the
 * simulation repo is committed here or anywhere else in this repository.
 */
import { describe, expect, it } from 'vitest';
import {
  SIMULATION_GUARD_CODES,
  SIMULATION_MAX_BYTES,
  SIMULATION_WATERMARK,
  checkSimulationUpload,
  isSimulationGuardCode,
  utf8ByteLength,
  type SimulationUploadCheck,
} from '../../supabase/functions/_shared/simulationUpload';

/** The smallest file every guard accepts. */
const VALID = [
  '<!doctype html>',
  '<html lang="id"><head><meta charset="utf-8"><title>t</title></head>',
  `<body><p class="mark">${SIMULATION_WATERMARK}</p>`,
  "<script>document.body.dataset.ready = '1';</script>",
  '</body></html>',
].join('\n');

const codesOf = (result: SimulationUploadCheck) => (result.ok ? [] : result.failures.map((f) => f.code));

describe('a file that passes', () => {
  it('accepts the minimal valid fixture and reports its UTF-8 size', () => {
    const result = checkSimulationUpload(VALID);
    expect(result).toEqual({ ok: true, bytes: utf8ByteLength(VALID) });
  });

  it('accepts a BOM, leading whitespace and an upper-case doctype', () => {
    expect(checkSimulationUpload(`﻿ \n\t${VALID.replace('<!doctype html>', '<!DOCTYPE HTML>')}`).ok).toBe(true);
  });

  it('does not read prefetch( or fetchAll as a fetch call', () => {
    const html = VALID.replace("'1';", "'1'; const prefetch = () => 0; prefetch(); const fetchAll = 1;");
    expect(checkSimulationUpload(html).ok).toBe(true);
  });
});

describe('one fixture per guard, each failing exactly that guard', () => {
  it('SIM-SIZE counts UTF-8 bytes, not characters, and the limit is inclusive', () => {
    const pad = (n: number) => VALID.replace('</body>', `<!--${'a'.repeat(n)}--></body>`);
    const base = utf8ByteLength(pad(0));
    const atLimit = pad(SIMULATION_MAX_BYTES - base);
    expect(utf8ByteLength(atLimit)).toBe(SIMULATION_MAX_BYTES);
    expect(checkSimulationUpload(atLimit).ok).toBe(true);
    expect(codesOf(checkSimulationUpload(pad(SIMULATION_MAX_BYTES - base + 1)))).toEqual(['SIM-SIZE']);

    // Two bytes per 'é': fewer characters than the limit, more bytes.
    const wide = VALID.replace('</body>', `<!--${'é'.repeat(Math.ceil(SIMULATION_MAX_BYTES / 2))}--></body>`);
    expect(wide.length).toBeLessThan(SIMULATION_MAX_BYTES);
    expect(codesOf(checkSimulationUpload(wide))).toEqual(['SIM-SIZE']);
  });

  it('SIM-DOCTYPE', () => {
    expect(codesOf(checkSimulationUpload(VALID.replace('<!doctype html>', '')))).toEqual(['SIM-DOCTYPE']);
    expect(codesOf(checkSimulationUpload(`<p>x</p>${VALID}`))).toEqual(['SIM-DOCTYPE']);
  });

  it('SIM-WATERMARK is the exact string, em dash included', () => {
    const hyphen = VALID.replace(SIMULATION_WATERMARK, 'SIMULATION - illustrative figures');
    const enDash = VALID.replace(SIMULATION_WATERMARK, 'SIMULATION – illustrative figures');
    expect(codesOf(checkSimulationUpload(hyphen))).toEqual(['SIM-WATERMARK']);
    expect(codesOf(checkSimulationUpload(enDash))).toEqual(['SIM-WATERMARK']);
  });

  it('SIM-URL catches http and https in any case, and counts them', () => {
    const one = VALID.replace('</body>', '<a href="https://example.test/x">x</a></body>');
    const upper = VALID.replace('</body>', '<img src="HTTP://example.test/y.png"></body>');
    expect(codesOf(checkSimulationUpload(one))).toEqual(['SIM-URL']);
    expect(codesOf(checkSimulationUpload(upper))).toEqual(['SIM-URL']);
    const two = checkSimulationUpload(`${one}\n<!-- http://example.test -->`);
    expect(two.ok ? '' : two.failures[0].message).toContain('2 alamat');
  });

  it.each([
    ['localStorage', 'localStorage.getItem("k");'],
    ['sessionStorage', 'sessionStorage.setItem("k", "v");'],
    ['indexedDB', 'indexedDB.open("db");'],
    ['XMLHttpRequest', 'new XMLHttpRequest();'],
    ['WebSocket', 'new WebSocket("ws://x");'],
    ['sendBeacon', 'navigator.sendBeacon("/x");'],
    ['fetch(', 'fetch ("/x");'],
  ])('SIM-NETAPI catches %s', (name, call) => {
    const result = checkSimulationUpload(VALID.replace("'1';", `'1'; ${call}`));
    expect(codesOf(result)).toEqual(['SIM-NETAPI']);
    expect(result.ok ? '' : result.failures[0].message).toContain(name);
  });
});

describe('every failure, never just the first', () => {
  it('a file failing three guards returns all three, in report order', () => {
    const html = VALID.replace('<!doctype html>', '').replace("'1';", "'1'; fetch('/a');").replace(
      '</body>',
      '<a href="https://example.test">x</a></body>',
    );
    const result = checkSimulationUpload(html);
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toEqual(['SIM-DOCTYPE', 'SIM-URL', 'SIM-NETAPI']);
    expect(result.ok ? [] : result.failures.every((f) => f.message.length > 0)).toBe(true);
  });

  it('names every offending API in one SIM-NETAPI message', () => {
    const result = checkSimulationUpload(VALID.replace("'1';", "'1'; localStorage.x; fetch('/a');"));
    expect(result.ok ? '' : result.failures[0].message).toMatch(/localStorage.*fetch\(/);
  });
});

describe('floor checks — a broken validator must not read as a healthy one', () => {
  it('refuses the empty string, with SIM-EMPTY among the reasons', () => {
    const empty = checkSimulationUpload('');
    expect(empty.ok).toBe(false);
    expect(codesOf(empty)).toContain('SIM-EMPTY');
    expect(codesOf(checkSimulationUpload('  \n\t '))).toContain('SIM-EMPTY');
  });

  it('refuses a bare doctype — nothing to show, and no watermark', () => {
    expect(checkSimulationUpload('<!doctype html>').ok).toBe(false);
  });

  it('knows exactly the six documented codes', () => {
    expect([...SIMULATION_GUARD_CODES]).toEqual([
      'SIM-SIZE',
      'SIM-EMPTY',
      'SIM-DOCTYPE',
      'SIM-WATERMARK',
      'SIM-URL',
      'SIM-NETAPI',
    ]);
    expect(isSimulationGuardCode('SIM-URL')).toBe(true);
    expect(isSimulationGuardCode('SIM-OTHER')).toBe(false);
    expect(isSimulationGuardCode(7)).toBe(false);
  });
});
