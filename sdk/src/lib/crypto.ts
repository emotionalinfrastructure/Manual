// Cross-runtime crypto primitives: no `node:crypto`, no npm dependency, and
// no async requirement, so the SDK's existing synchronous public API
// (ConsentTokenID.create, AuditLogger.log, TrustRepair.*, ToleranceWindowManager.create)
// doesn't have to change to run outside Node (browsers, edge/Workers runtimes).
import { sha256Hex as pureSha256Hex } from './sha256.js';

/** RFC 4122 v4 UUID using the Web Crypto CSPRNG available in Node >=20, all
 * evergreen browsers, and edge/Workers runtimes. */
export function randomUUID(): string {
  const g = globalThis as { crypto?: Crypto };
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  if (typeof g.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    g.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  throw new Error(
    'EIS-SDK: no CSPRNG available in this runtime (needs globalThis.crypto.randomUUID or .getRandomValues).'
  );
}

/** SHA-256 of a UTF-8 string as lowercase hex. Pure-JS so it runs identically
 * in Node and non-Node runtimes; see lib/sha256.ts. */
export function sha256Hex(input: string): string {
  return pureSha256Hex(input);
}
