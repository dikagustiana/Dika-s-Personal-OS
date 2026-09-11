// sha256 over UTF-8, hex — the same digest public.os_inst_corpus_guard
// recomputes on insert (encode(sha256(convert_to(content,'UTF8')),'hex')). A
// record whose hash does not verify is refused by the database; this module
// exists so the tool layer computes the hash the same way and the refusal
// never fires in practice. WebCrypto: present in Deno and in Node >= 19.

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** A tool token: 32 random bytes, hex. Only its sha256 is ever stored. */
export function randomHex(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export const HEX64 = /^[0-9a-f]{64}$/;
