import { createHash } from 'node:crypto';
import { sha256Hex } from '../src/lib/sha256.js';

describe('sha256Hex (pure-JS)', () => {
  // NIST FIPS 180-4 / well-known test vectors.
  test('matches the known digest of the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('matches the known digest of "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('matches the known digest of the NIST two-block message', () => {
    const input = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(sha256Hex(input)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  test('matches node:crypto across a range of lengths, including block-boundary edge cases', () => {
    const lengths = [0, 1, 15, 55, 56, 57, 63, 64, 65, 127, 128, 129, 500];
    for (const len of lengths) {
      const input = 'x'.repeat(len);
      const expected = createHash('sha256').update(input).digest('hex');
      expect(sha256Hex(input)).toBe(expected);
    }
  });

  test('matches node:crypto for multi-byte UTF-8 input', () => {
    const input = 'Emotional Infrastructure™ — 你好, мир, 🔒';
    const expected = createHash('sha256').update(input).digest('hex');
    expect(sha256Hex(input)).toBe(expected);
  });

  test('is deterministic', () => {
    expect(sha256Hex('deterministic-input')).toBe(sha256Hex('deterministic-input'));
  });
});
