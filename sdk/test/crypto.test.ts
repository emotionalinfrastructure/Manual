import { randomUUID } from '../src/lib/crypto.js';

describe('randomUUID (cross-runtime shim)', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  test('produces a well-formed v4 UUID', () => {
    expect(randomUUID()).toMatch(UUID_V4);
  });

  test('produces unique values across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomUUID()));
    expect(ids.size).toBe(1000);
  });

  test('falls back to getRandomValues when crypto.randomUUID is unavailable', async () => {
    const originalCrypto = globalThis.crypto;
    const getRandomValuesSpy = jest.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i += 1) arr[i] = i;
      return arr;
    });
    // @ts-expect-error -- simulating a runtime without crypto.randomUUID
    globalThis.crypto = { getRandomValues: getRandomValuesSpy };

    try {
      const id = randomUUID();
      expect(id).toMatch(UUID_V4);
      expect(getRandomValuesSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.crypto = originalCrypto;
    }
  });

  test('throws a clear error when no CSPRNG is available', () => {
    const originalCrypto = globalThis.crypto;
    // @ts-expect-error -- simulating a runtime with no Web Crypto at all
    globalThis.crypto = undefined;

    try {
      expect(() => randomUUID()).toThrow(/no CSPRNG available/);
    } finally {
      globalThis.crypto = originalCrypto;
    }
  });
});
