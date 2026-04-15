/**
 * Environment-scoped fail-closed helpers. Safe to import from both the
 * Edge-runtime proxy and the Node.js API routes — must not pull in any
 * Node-only APIs (no next/headers, no node:crypto).
 */
let cached: Uint8Array | null = null;

export function getJwtSecret(): Uint8Array {
  if (cached) return cached;
  const raw = process.env.JWT_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      'JWT_SECRET is required (minimum 16 chars). Refusing to start with an insecure default.',
    );
  }
  cached = new TextEncoder().encode(raw);
  return cached;
}
