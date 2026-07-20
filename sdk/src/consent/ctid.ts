import { createHash, randomUUID } from 'node:crypto';
import type { ConsentToken, ConsentTokenIDInput, ConsentTokenInput } from '../types/index.js';

export class ConsentTokenID {
  private static readonly PREFIX = 'ctid';
  private static readonly FORMAT = /^ctid-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  static generate(input: ConsentTokenIDInput): string {
    ConsentTokenID.assertRequired(input.userId, 'userId');
    ConsentTokenID.assertRequired(input.purpose, 'purpose');
    ConsentTokenID.assertRequired(input.scope, 'scope');

    if (input.deterministic === true) {
      const digest = createHash('sha256')
        .update(`${input.userId}|${input.purpose}|${input.scope}`)
        .digest('hex');
      return `${ConsentTokenID.PREFIX}-${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    }

    return `${ConsentTokenID.PREFIX}-${randomUUID()}`;
  }

  static create(input: ConsentTokenInput): ConsentToken {
    const createdAt = new Date();
    const generateInput: ConsentTokenIDInput = {
      userId: input.userId,
      purpose: input.purpose,
      scope: input.scope,
    };

    if (input.deterministic !== undefined) {
      generateInput.deterministic = input.deterministic;
    }

    const ctid = ConsentTokenID.generate(generateInput);

    const token: ConsentToken = {
      ctid,
      userId: input.userId,
      purpose: input.purpose,
      scope: input.scope,
      createdAt,
      status: 'active',
      metadata: { ...(input.metadata ?? {}) },
    };

    if (input.expiresAt !== undefined) {
      token.expiresAt = new Date(input.expiresAt);
    } else if (input.expiresIn !== undefined) {
      token.expiresAt = new Date(createdAt.getTime() + input.expiresIn);
    }

    return token;
  }

  static isValid(ctid: string): boolean {
    return ConsentTokenID.FORMAT.test(ctid);
  }

  static isExpired(token: ConsentToken, now: Date = new Date()): boolean {
    return token.expiresAt !== undefined && token.expiresAt.getTime() <= now.getTime();
  }

  static isActive(token: ConsentToken, now: Date = new Date()): boolean {
    return token.status === 'active' && !ConsentTokenID.isExpired(token, now);
  }

  static revoke(token: ConsentToken, reason: string, operator = 'system'): ConsentToken {
    return {
      ...token,
      status: 'revoked',
      statusReason: reason,
      updatedAt: new Date(),
      lastOperator: operator,
    };
  }

  static suspend(token: ConsentToken, until: Date, reason: string, operator = 'system'): ConsentToken {
    return {
      ...token,
      status: 'suspended',
      suspendedUntil: new Date(until),
      statusReason: reason,
      updatedAt: new Date(),
      lastOperator: operator,
    };
  }

  static expire(token: ConsentToken, reason = 'Consent token expired', operator = 'system'): ConsentToken {
    return {
      ...token,
      status: 'expired',
      statusReason: reason,
      updatedAt: new Date(),
      lastOperator: operator,
    };
  }

  static renew(token: ConsentToken, expiresIn: number, operator = 'system'): ConsentToken {
    if (token.status === 'revoked') {
      throw new Error('Cannot renew a revoked consent token');
    }

    return {
      ...token,
      status: 'active',
      expiresAt: new Date(Date.now() + expiresIn),
      updatedAt: new Date(),
      statusReason: 'Consent renewed',
      lastOperator: operator,
    };
  }

  private static assertRequired(value: string, field: string): void {
    if (value.trim().length === 0) {
      throw new Error(`${field} is required`);
    }
  }
}
