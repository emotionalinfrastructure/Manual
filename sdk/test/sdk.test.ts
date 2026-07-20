import { AuditLogger, ConsentStateMachine, ConsentTokenID, ToleranceWindowManager, TraceValidator, TrustRepair } from '../src/index.js';

describe('EIS SDK', () => {
  it('creates and validates consent tokens', () => {
    const token = ConsentTokenID.create({
      userId: 'user-123',
      purpose: 'test',
      scope: 'adaptation',
      deterministic: true,
    });

    expect(ConsentTokenID.isValid(token.ctid)).toBe(true);
    expect(ConsentTokenID.isActive(token)).toBe(true);
  });

  it('enforces consent state transitions', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const result = ConsentStateMachine.transition(token, 'revoked', 'user request');

    expect(result.success).toBe(true);
    expect(result.token?.status).toBe('revoked');
  });

  it('records tolerance window interactions', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const window = ToleranceWindowManager.create({
      ctid: token.ctid,
      durationMs: 1000,
      interactionLimit: 2,
      behaviorThreshold: 0.5,
    });

    const result = ToleranceWindowManager.recordInteraction(window, 0.8);
    expect(result.success).toBe(true);
    expect(result.window?.interactionCount).toBe(1);
  });

  it('logs and validates audit traces', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const logger = new AuditLogger();
    logger.log(AuditLogger.createEvent({ ctid: token.ctid, eventType: 'consent_registered', operator: 'system', payload: {} }));

    const validation = TraceValidator.validate(logger.getAllEvents());
    expect(validation.valid).toBe(true);
  });

  it('detects and initializes repair', () => {
    const token = ConsentTokenID.create({ userId: 'u', purpose: 'p', scope: 's' });
    const rupture = TrustRepair.detectRupture({
      ctid: token.ctid,
      expectedBehavior: 'helpful transparent consistent',
      observedBehavior: 'dismissive evasive inconsistent',
      confidenceThreshold: 0.5,
      auditTrail: [],
    });

    expect(rupture.detected).toBe(true);
  });
});
