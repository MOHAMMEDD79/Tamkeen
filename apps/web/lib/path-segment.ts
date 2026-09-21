/**
 * Encodes one path segment for an API call, given a route parameter from Next.
 *
 * Next hands a dynamic segment **still percent-encoded**, so calling `encodeURIComponent` on it
 * encodes the percent signs again and the API is asked for a slug that does not exist. Every ASCII
 * slug survives that unharmed, which is why it stayed hidden until an Arabic one appeared — and
 * this product is Arabic-first, so the public project and organisation pages had the same bug
 * waiting behind their seeded ASCII slugs.
 *
 * Decoding first makes it right whichever form arrives, and makes the function idempotent. A
 * malformed escape is passed through rather than throwing: the API then answers "not found", which
 * is the correct response to a bad URL, where a 500 would not be.
 *
 * It lives in its own file, free of `server-only`, so a test can import it.
 */
export function pathSegment(value: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
}
