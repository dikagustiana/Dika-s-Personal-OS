import { describe, expect, it } from 'vitest';
import {
  appendDocument,
  isSafeDocumentUrl,
  makeDocument,
  normalizeDocumentUrl,
  removeDocumentAt,
} from './documents';

const now = new Date('2026-07-25T09:00:00.000Z');

describe('isSafeDocumentUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeDocumentUrl('https://drive.google.com/file/d/abc')).toBe(true);
    expect(isSafeDocumentUrl('http://intranet.local/doc')).toBe(true);
  });

  it('rejects script-bearing and non-web schemes', () => {
    expect(isSafeDocumentUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeDocumentUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeDocumentUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects anything that is not a URL', () => {
    expect(isSafeDocumentUrl('')).toBe(false);
    expect(isSafeDocumentUrl('just some text')).toBe(false);
  });
});

describe('normalizeDocumentUrl', () => {
  it('adds https to a bare host', () => {
    expect(normalizeDocumentUrl('drive.google.com/file/d/abc')).toBe(
      'https://drive.google.com/file/d/abc',
    );
  });

  it('leaves an existing scheme alone, including a hostile one', () => {
    expect(normalizeDocumentUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeDocumentUrl('javascript:alert(1)')).toBe('javascript:alert(1)');
  });
});

describe('makeDocument', () => {
  it('builds a document with an ISO timestamp', () => {
    expect(makeDocument('Master instructions', 'https://example.com/doc', now)).toEqual({
      label: 'Master instructions',
      url: 'https://example.com/doc',
      addedAt: '2026-07-25T09:00:00.000Z',
    });
  });

  it('falls back to the last path segment when no label is given', () => {
    expect(makeDocument('  ', 'https://example.com/files/close-pack.xlsx', now)?.label).toBe(
      'close-pack.xlsx',
    );
  });

  it('falls back to the host when there is no path', () => {
    expect(makeDocument('', 'https://example.com', now)?.label).toBe('example.com');
  });

  it('refuses an unusable or unsafe link', () => {
    expect(makeDocument('Anything', 'javascript:alert(1)', now)).toBeNull();
    expect(makeDocument('Anything', '', now)).toBeNull();
  });
});

describe('appendDocument / removeDocumentAt', () => {
  const doc = { label: 'A', url: 'https://a.example', addedAt: '2026-07-25T09:00:00.000Z' };

  it('appends to an absent list without mutating', () => {
    expect(appendDocument(undefined, doc)).toEqual([doc]);
    const existing = [doc];
    expect(appendDocument(existing, doc)).toHaveLength(2);
    expect(existing).toHaveLength(1);
  });

  it('removes by position and tolerates an absent list', () => {
    expect(removeDocumentAt([doc], 0)).toEqual([]);
    expect(removeDocumentAt(undefined, 0)).toEqual([]);
  });
});
