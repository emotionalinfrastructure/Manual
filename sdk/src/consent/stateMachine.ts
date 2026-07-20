import type { ConsentStatus, ConsentToken, ConsentTransitionResult } from '../types/index.js';

export class ConsentStateMachine {
  private static readonly TRANSITIONS: Record<ConsentStatus, ConsentStatus[]> = {
    active: ['suspended', 'revoked', 'expired', 'pending_review'],
    suspended: ['active', 'revoked', 'expired', 'pending_review'],
    pending_review: ['active', 'suspended', 'revoked', 'expired'],
    revoked: [],
    expired: [],
  };

  static canTransition(from: ConsentStatus, to: ConsentStatus): boolean {
    return ConsentStateMachine.TRANSITIONS[from].includes(to);
  }

  static transition(
    token: ConsentToken,
    to: ConsentStatus,
    reason: string,
    operator = 'system'
  ): ConsentTransitionResult {
    if (!ConsentStateMachine.canTransition(token.status, to)) {
      return {
        success: false,
        error: `Invalid transition: ${token.status} → ${to}`,
      };
    }

    const nextToken: ConsentToken = {
      ...token,
      status: to,
      statusReason: reason,
      updatedAt: new Date(),
      lastOperator: operator,
    };

    return { success: true, token: nextToken };
  }

  static getPossibleTransitions(status: ConsentStatus): ConsentStatus[] {
    return [...ConsentStateMachine.TRANSITIONS[status]];
  }

  static isTerminal(status: ConsentStatus): boolean {
    return ConsentStateMachine.TRANSITIONS[status].length === 0;
  }

  static assertTransition(from: ConsentStatus, to: ConsentStatus): void {
    if (!ConsentStateMachine.canTransition(from, to)) {
      throw new Error(`Invalid transition: ${from} → ${to}`);
    }
  }

  static isReviewable(status: ConsentStatus): boolean {
    return status === 'active' || status === 'suspended' || status === 'pending_review';
  }

  static requiresHumanReview(from: ConsentStatus, to: ConsentStatus): boolean {
    return to === 'pending_review' || (from === 'suspended' && to === 'active');
  }

  static describe(status: ConsentStatus): string {
    const descriptions: Record<ConsentStatus, string> = {
      active: 'Consent is currently active and usable if not expired.',
      suspended: 'Consent is temporarily paused and may be restored through a valid transition.',
      revoked: 'Consent has been revoked and is terminal.',
      expired: 'Consent has expired and is terminal.',
      pending_review: 'Consent requires review before normal processing continues.',
    };
    return descriptions[status];
  }
}
