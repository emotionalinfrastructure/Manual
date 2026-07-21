import { ConsentTokenID } from '../src/consent/ctid.js';
import { ConsentStateMachine } from '../src/consent/stateMachine.js';
import type { ConsentStatus } from '../src/types/index.js';

const ALL_STATUSES: ConsentStatus[] = ['active', 'suspended', 'revoked', 'expired', 'pending_review'];

describe('ConsentStateMachine', () => {
  test('canTransition matches the documented transition table', () => {
    expect(ConsentStateMachine.canTransition('active', 'suspended')).toBe(true);
    expect(ConsentStateMachine.canTransition('active', 'revoked')).toBe(true);
    expect(ConsentStateMachine.canTransition('revoked', 'active')).toBe(false);
    expect(ConsentStateMachine.canTransition('expired', 'active')).toBe(false);
  });

  test('transition succeeds and stamps reason/operator/updatedAt for a valid move', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const result = ConsentStateMachine.transition(token, 'suspended', 'cooling off', 'alice');

    expect(result.success).toBe(true);
    expect(result.token?.status).toBe('suspended');
    expect(result.token?.statusReason).toBe('cooling off');
    expect(result.token?.lastOperator).toBe('alice');
    expect(result.token?.updatedAt).toBeInstanceOf(Date);
  });

  test('transition fails for an invalid move and reports both states', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const revoked = { ...token, status: 'revoked' as ConsentStatus };
    const result = ConsentStateMachine.transition(revoked, 'active', 'attempt reactivation');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid transition: revoked → active');
    expect(result.token).toBeUndefined();
  });

  test('transition defaults operator to "system"', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const result = ConsentStateMachine.transition(token, 'suspended', 'auto-suspend');
    expect(result.token?.lastOperator).toBe('system');
  });

  test('getPossibleTransitions returns a copy, not the internal array', () => {
    const options = ConsentStateMachine.getPossibleTransitions('active');
    options.push('revoked');
    expect(ConsentStateMachine.getPossibleTransitions('active')).not.toContain(undefined);
    expect(ConsentStateMachine.getPossibleTransitions('active').length).toBe(4);
  });

  test('isTerminal is true only for revoked and expired', () => {
    expect(ConsentStateMachine.isTerminal('revoked')).toBe(true);
    expect(ConsentStateMachine.isTerminal('expired')).toBe(true);
    expect(ConsentStateMachine.isTerminal('active')).toBe(false);
    expect(ConsentStateMachine.isTerminal('suspended')).toBe(false);
    expect(ConsentStateMachine.isTerminal('pending_review')).toBe(false);
  });

  test('assertTransition throws for an invalid move and is silent for a valid one', () => {
    expect(() => ConsentStateMachine.assertTransition('revoked', 'active')).toThrow('Invalid transition: revoked → active');
    expect(() => ConsentStateMachine.assertTransition('active', 'revoked')).not.toThrow();
  });

  test('isReviewable is true for active, suspended, and pending_review only', () => {
    expect(ConsentStateMachine.isReviewable('active')).toBe(true);
    expect(ConsentStateMachine.isReviewable('suspended')).toBe(true);
    expect(ConsentStateMachine.isReviewable('pending_review')).toBe(true);
    expect(ConsentStateMachine.isReviewable('revoked')).toBe(false);
    expect(ConsentStateMachine.isReviewable('expired')).toBe(false);
  });

  test('requiresHumanReview flags moves into pending_review and suspended->active', () => {
    expect(ConsentStateMachine.requiresHumanReview('active', 'pending_review')).toBe(true);
    expect(ConsentStateMachine.requiresHumanReview('suspended', 'active')).toBe(true);
    expect(ConsentStateMachine.requiresHumanReview('active', 'suspended')).toBe(false);
    expect(ConsentStateMachine.requiresHumanReview('pending_review', 'revoked')).toBe(false);
  });

  test('describe returns a non-empty, distinct description for every status', () => {
    const descriptions = ALL_STATUSES.map(status => ConsentStateMachine.describe(status));
    expect(new Set(descriptions).size).toBe(ALL_STATUSES.length);
    for (const description of descriptions) {
      expect(description.length).toBeGreaterThan(0);
    }
  });
});
