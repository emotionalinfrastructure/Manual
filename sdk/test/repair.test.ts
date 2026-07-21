import { TrustRepair } from '../src/repair/index.js';
import type { TrustDelta, TrustRepairContext } from '../src/types/index.js';

describe('TrustRepair.detectRupture', () => {
  test('does not detect a rupture when behavior matches expectations', () => {
    const result = TrustRepair.detectRupture({
      ctid: 'c',
      expectedBehavior: 'helpful transparent consistent',
      observedBehavior: 'helpful transparent consistent',
      confidenceThreshold: 0.5,
      auditTrail: [],
    });
    expect(result.detected).toBe(false);
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.reasoning).toContain('No rupture detected');
  });

  test('detects a rupture when observed behavior diverges past the threshold', () => {
    const result = TrustRepair.detectRupture({
      ctid: 'c',
      expectedBehavior: 'helpful transparent consistent',
      observedBehavior: 'dismissive evasive inconsistent unsafe manipulative',
      confidenceThreshold: 0.5,
      auditTrail: [],
    });
    expect(result.detected).toBe(true);
    expect(result.signals).toEqual(
      expect.arrayContaining(['dismissive', 'evasive', 'inconsistent', 'unsafe', 'manipulative'])
    );
    expect(result.reasoning).toContain('diverged');
  });

  test('confidence is clamped to [0, 1]', () => {
    const result = TrustRepair.detectRupture({
      ctid: 'c',
      expectedBehavior: '',
      observedBehavior: 'dismissive evasive contradictory inconsistent unsafe coercive manipulative unreliable opaque harmful',
      confidenceThreshold: 0.9,
      auditTrail: [],
    });
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe('TrustRepair.createDelta', () => {
  test('defaults reversible to true and stamps createdAt', () => {
    const delta = TrustRepair.createDelta({ ctid: 'c', before: 'positive', after: 'negative', cause: 'tone shift' });
    expect(delta.reversible).toBe(true);
    expect(delta.createdAt).toBeInstanceOf(Date);
  });

  test('honors an explicit reversible value', () => {
    const delta = TrustRepair.createDelta({
      ctid: 'c',
      before: 'positive',
      after: 'negative',
      cause: 'severe issue',
      reversible: false,
    });
    expect(delta.reversible).toBe(false);
  });
});

describe('TrustRepair.evaluateSeverity', () => {
  const base: TrustDelta = {
    id: 'td-1',
    ctid: 'c',
    before: 'positive',
    after: 'negative',
    cause: '',
    reversible: true,
    createdAt: new Date(),
  };

  test('critical when the cause mentions harm, unsafe, coercion, or manipulation', () => {
    for (const cause of ['caused harm', 'unsafe output', 'coercive framing', 'manipulated the user']) {
      expect(TrustRepair.evaluateSeverity({ ...base, cause })).toBe('critical');
    }
  });

  test('high for an irreversible positive-to-negative shift without a critical cause', () => {
    expect(TrustRepair.evaluateSeverity({ ...base, cause: 'tone shift', reversible: false })).toBe('high');
  });

  test('medium for any other negative outcome', () => {
    expect(TrustRepair.evaluateSeverity({ ...base, before: 'neutral', cause: 'tone shift', reversible: true })).toBe(
      'medium'
    );
  });

  test('low when the outcome is not negative', () => {
    expect(TrustRepair.evaluateSeverity({ ...base, after: 'neutral', cause: 'minor note' })).toBe('low');
  });
});

describe('TrustRepair.recommendStrategy', () => {
  const base = { ctid: 'c', severity: 'low' as const, reversible: true, priorRepairAttempts: 0, auditTrailLength: 10 };

  test('escalation for critical severity', () => {
    expect(TrustRepair.recommendStrategy({ ...base, severity: 'critical' })).toBe('escalation');
  });

  test('escalation after repeated prior attempts, regardless of severity', () => {
    expect(TrustRepair.recommendStrategy({ ...base, priorRepairAttempts: 2 })).toBe('escalation');
  });

  test('remediation for an irreversible high-severity rupture', () => {
    expect(TrustRepair.recommendStrategy({ ...base, severity: 'high', reversible: false })).toBe('remediation');
  });

  test('transparency when the audit trail is too short to assess', () => {
    expect(TrustRepair.recommendStrategy({ ...base, auditTrailLength: 1 })).toBe('transparency');
  });

  test('reset for medium severity with a sufficient audit trail', () => {
    expect(TrustRepair.recommendStrategy({ ...base, severity: 'medium' })).toBe('reset');
  });

  test('falls back to transparency otherwise', () => {
    expect(TrustRepair.recommendStrategy(base)).toBe('transparency');
  });
});

describe('TrustRepair.initiateRepair / executeRepair / completeRepair / failRepair', () => {
  test('initiateRepair captures signals and starts in "initiated" status', () => {
    const repair = TrustRepair.initiateRepair({
      ctid: 'c',
      detectedAt: new Date(),
      signals: ['evasive'],
      strategy: 'transparency',
      auditTrail: [],
    });
    expect(repair.status).toBe('initiated');
    expect(repair.signals).toEqual(['evasive']);
  });

  test.each(['transparency', 'reset', 'remediation', 'escalation'] as const)(
    'executeRepair returns a success outcome and next action for strategy %s',
    strategy => {
      const repair = TrustRepair.initiateRepair({
        ctid: 'c',
        detectedAt: new Date(),
        signals: [],
        strategy,
        auditTrail: [],
      });
      const outcome = TrustRepair.executeRepair(repair);
      expect(outcome.success).toBe(true);
      expect(outcome.nextAction.length).toBeGreaterThan(0);
    }
  );

  test('completeRepair and failRepair set terminal status, outcome, and completedAt', () => {
    const repair = TrustRepair.initiateRepair({
      ctid: 'c',
      detectedAt: new Date(),
      signals: [],
      strategy: 'reset',
      auditTrail: [],
    });

    const completed = TrustRepair.completeRepair(repair, 'resolved cleanly');
    expect(completed.status).toBe('completed');
    expect(completed.outcome).toBe('resolved cleanly');
    expect(completed.completedAt).toBeInstanceOf(Date);

    const failed = TrustRepair.failRepair(repair, 'could not resolve');
    expect(failed.status).toBe('failed');
    expect(failed.outcome).toBe('could not resolve');
  });
});

describe('TrustRepair.assessReEngagementReadiness / isResolved', () => {
  function completedRepair(strategy: TrustRepairContext['strategy']): TrustRepairContext {
    return TrustRepair.completeRepair(
      TrustRepair.initiateRepair({ ctid: 'c', detectedAt: new Date(), signals: [], strategy, auditTrail: [] }),
      'done'
    );
  }

  test('not ready before the strategy-specific wait period elapses', () => {
    const repair = completedRepair('reset');
    const assessment = TrustRepair.assessReEngagementReadiness(repair, 1000);
    expect(assessment.ready).toBe(false);
    expect(assessment.requiredWaitMs).toBe(24 * 60 * 60 * 1000);
  });

  test('ready once the wait period has elapsed and the repair is completed', () => {
    const repair = completedRepair('transparency');
    const assessment = TrustRepair.assessReEngagementReadiness(repair, 60 * 60 * 1000 + 1);
    expect(assessment.ready).toBe(true);
  });

  test('not ready if the repair is not completed, even after the wait elapses', () => {
    const repair = TrustRepair.initiateRepair({
      ctid: 'c',
      detectedAt: new Date(),
      signals: [],
      strategy: 'transparency',
      auditTrail: [],
    });
    const assessment = TrustRepair.assessReEngagementReadiness(repair, 10 * 60 * 60 * 1000);
    expect(assessment.ready).toBe(false);
  });

  test('escalation requires the longest wait (7 days)', () => {
    const repair = completedRepair('escalation');
    const assessment = TrustRepair.assessReEngagementReadiness(repair, 0);
    expect(assessment.requiredWaitMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('remediation requires a 72-hour wait', () => {
    const repair = completedRepair('remediation');
    const assessment = TrustRepair.assessReEngagementReadiness(repair, 0);
    expect(assessment.requiredWaitMs).toBe(72 * 60 * 60 * 1000);
  });

  test('isResolved mirrors completed status', () => {
    expect(TrustRepair.isResolved(completedRepair('reset'))).toBe(true);
    expect(
      TrustRepair.isResolved(
        TrustRepair.initiateRepair({ ctid: 'c', detectedAt: new Date(), signals: [], strategy: 'reset', auditTrail: [] })
      )
    ).toBe(false);
  });
});

describe('TrustRepair.summarizeRepair', () => {
  test('lists signals when present and says "none" when empty', () => {
    const withSignals = TrustRepair.initiateRepair({
      ctid: 'c',
      detectedAt: new Date(),
      signals: ['evasive', 'opaque'],
      strategy: 'transparency',
      auditTrail: [],
    });
    expect(TrustRepair.summarizeRepair(withSignals)).toContain('evasive, opaque');

    const withoutSignals = TrustRepair.initiateRepair({
      ctid: 'c',
      detectedAt: new Date(),
      signals: [],
      strategy: 'transparency',
      auditTrail: [],
    });
    expect(TrustRepair.summarizeRepair(withoutSignals)).toContain('none');
  });
});
