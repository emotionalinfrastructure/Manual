import { ConsentTokenID } from '../src/consent/ctid.js';

describe('ConsentTokenID', () => {
  test('rejects empty required fields', () => {
    expect(() => ConsentTokenID.generate({ userId: '', purpose: 'p', scope: 's' })).toThrow('userId is required');
    expect(() => ConsentTokenID.generate({ userId: 'u', purpose: ' ', scope: 's' })).toThrow('purpose is required');
    expect(() => ConsentTokenID.generate({ userId: 'u', purpose: 'p', scope: '' })).toThrow('scope is required');
  });

  test('random (non-deterministic) generation produces a valid, unique ctid each time', () => {
    const a = ConsentTokenID.generate({ userId: 'u', purpose: 'p', scope: 's' });
    const b = ConsentTokenID.generate({ userId: 'u', purpose: 'p', scope: 's' });
    expect(ConsentTokenID.isValid(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  test('deterministic generation is stable for the same inputs and differs for different inputs', () => {
    const a = ConsentTokenID.generate({ userId: 'u', purpose: 'p', scope: 's', deterministic: true });
    const b = ConsentTokenID.generate({ userId: 'u', purpose: 'p', scope: 's', deterministic: true });
    const c = ConsentTokenID.generate({ userId: 'u2', purpose: 'p', scope: 's', deterministic: true });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(ConsentTokenID.isValid(a)).toBe(true);
  });

  test('isValid rejects malformed ctids', () => {
    expect(ConsentTokenID.isValid('not-a-ctid')).toBe(false);
    expect(ConsentTokenID.isValid('ctid-not-hex-not-hex-not-hex-not-hex')).toBe(false);
  });

  test('create sets expiresAt from expiresIn, and defaults to no expiry', () => {
    const withExpiry = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's', expiresIn: 1000 });
    expect(withExpiry.expiresAt).toBeInstanceOf(Date);

    const withoutExpiry = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    expect(withoutExpiry.expiresAt).toBeUndefined();
  });

  test('create honors an explicit expiresAt over expiresIn', () => {
    const explicit = new Date(Date.now() + 5000);
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's', expiresAt: explicit });
    expect(token.expiresAt?.getTime()).toBe(explicit.getTime());
  });

  test('isExpired / isActive reflect expiry', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's', expiresIn: -1 });
    expect(ConsentTokenID.isExpired(token)).toBe(true);
    expect(ConsentTokenID.isActive(token)).toBe(false);
  });

  test('isActive is false for a non-active status even if not expired', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const revoked = ConsentTokenID.revoke(token, 'user request');
    expect(ConsentTokenID.isActive(revoked)).toBe(false);
  });

  test('revoke sets status, reason, and operator', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const revoked = ConsentTokenID.revoke(token, 'no longer needed', 'alice');
    expect(revoked.status).toBe('revoked');
    expect(revoked.statusReason).toBe('no longer needed');
    expect(revoked.lastOperator).toBe('alice');
    expect(revoked.updatedAt).toBeInstanceOf(Date);
  });

  test('suspend sets a suspendedUntil date', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const until = new Date(Date.now() + 60_000);
    const suspended = ConsentTokenID.suspend(token, until, 'cooling off period');
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedUntil?.getTime()).toBe(until.getTime());
  });

  test('expire sets status to expired with a default reason', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const expired = ConsentTokenID.expire(token);
    expect(expired.status).toBe('expired');
    expect(expired.statusReason).toBe('Consent token expired');
  });

  test('renew reactivates and extends expiry', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's', expiresIn: -1 });
    expect(ConsentTokenID.isExpired(token)).toBe(true);

    const renewed = ConsentTokenID.renew(token, 60_000);
    expect(renewed.status).toBe('active');
    expect(ConsentTokenID.isExpired(renewed)).toBe(false);
  });

  test('renew throws for a revoked token', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const revoked = ConsentTokenID.revoke(token, 'done');
    expect(() => ConsentTokenID.renew(revoked, 60_000)).toThrow('Cannot renew a revoked consent token');
  });
});
