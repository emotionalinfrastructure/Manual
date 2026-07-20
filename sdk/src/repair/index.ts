import { randomUUID } from 'node:crypto';
import type {
  ReEngagementAssessment,
  RepairExecutionOutcome,
  RepairInitiationInput,
  RepairRecommendationInput,
  RepairSeverity,
  RepairStrategy,
  RuptureDetectionInput,
  RuptureDetectionResult,
  TrustDelta,
  TrustDeltaInput,
  TrustRepairContext,
} from '../types/index.js';

export class TrustRepair {
  static detectRupture(input: RuptureDetectionInput): RuptureDetectionResult {
    const expected = TrustRepair.normalize(input.expectedBehavior);
    const observed = TrustRepair.normalize(input.observedBehavior);
    const signals = TrustRepair.extractSignals(observed);
    const contradictionScore = TrustRepair.calculateContradictionScore(expected, observed, signals);
    const confidence = Math.min(Math.max(contradictionScore, 0), 1);
    const detected = confidence >= input.confidenceThreshold;

    const reasoning = detected
      ? `Observed behavior diverged from expected behavior with confidence ${confidence.toFixed(2)}.`
      : `No rupture detected; divergence confidence ${confidence.toFixed(2)} is below threshold ${input.confidenceThreshold.toFixed(2)}.`;

    return { detected, confidence, reasoning, signals };
  }

  static createDelta(input: TrustDeltaInput): TrustDelta {
    return {
      id: `td-${randomUUID()}`,
      ctid: input.ctid,
      before: input.before,
      after: input.after,
      cause: input.cause,
      reversible: input.reversible ?? true,
      createdAt: new Date(),
    };
  }

  static evaluateSeverity(delta: TrustDelta): RepairSeverity {
    const cause = delta.cause.toLowerCase();
    if (cause.includes('harm') || cause.includes('unsafe') || cause.includes('coerc') || cause.includes('manipulat')) {
      return 'critical';
    }

    if (delta.before === 'positive' && delta.after === 'negative' && !delta.reversible) {
      return 'high';
    }

    if (delta.after === 'negative') {
      return 'medium';
    }

    return 'low';
  }

  static recommendStrategy(input: RepairRecommendationInput): RepairStrategy {
    if (input.severity === 'critical') return 'escalation';
    if (input.priorRepairAttempts >= 2) return 'escalation';
    if (!input.reversible && input.severity === 'high') return 'remediation';
    if (input.auditTrailLength < 3) return 'transparency';
    if (input.severity === 'medium') return 'reset';
    return 'transparency';
  }

  static initiateRepair(input: RepairInitiationInput): TrustRepairContext {
    return {
      id: `repair-${randomUUID()}`,
      ctid: input.ctid,
      detectedAt: new Date(input.detectedAt),
      initiatedAt: new Date(),
      signals: [...input.signals],
      strategy: input.strategy,
      auditTrailLength: input.auditTrail.length,
      status: 'initiated',
    };
  }

  static executeRepair(repair: TrustRepairContext): RepairExecutionOutcome {
    switch (repair.strategy) {
      case 'transparency':
        return {
          success: true,
          outcome: 'Transparency repair prepared.',
          nextAction: 'Disclose what changed, why it changed, and what the user can do next.',
        };
      case 'reset':
        return {
          success: true,
          outcome: 'State reset repair prepared.',
          nextAction: 'Reset adaptive context and request renewed consent before continuing adaptation.',
        };
      case 'remediation':
        return {
          success: true,
          outcome: 'Remediation repair prepared.',
          nextAction: 'Provide corrective action, preserve evidence, and verify whether the rupture is reversible.',
        };
      case 'escalation':
        return {
          success: true,
          outcome: 'Escalation repair prepared.',
          nextAction: 'Route to human review and preserve audit trail before further adaptive processing.',
        };
    }
  }

  static completeRepair(repair: TrustRepairContext, outcome: string): TrustRepairContext {
    return {
      ...repair,
      status: 'completed',
      outcome,
      completedAt: new Date(),
    };
  }

  static failRepair(repair: TrustRepairContext, outcome: string): TrustRepairContext {
    return {
      ...repair,
      status: 'failed',
      outcome,
      completedAt: new Date(),
    };
  }

  static assessReEngagementReadiness(repair: TrustRepairContext, elapsedMs: number): ReEngagementAssessment {
    const requiredWaitMs = TrustRepair.requiredWaitForStrategy(repair.strategy);
    const completed = repair.status === 'completed';
    const ready = completed && elapsedMs >= requiredWaitMs;

    return {
      ready,
      elapsedMs,
      requiredWaitMs,
      recommendation: ready
        ? 'Re-engagement may proceed with renewed transparency and user control.'
        : 'Continue restricted processing until repair is complete and the required wait period has elapsed.',
    };
  }

  static isResolved(repair: TrustRepairContext): boolean {
    return repair.status === 'completed';
  }

  static summarizeRepair(repair: TrustRepairContext): string {
    return `Repair ${repair.id} for ${repair.ctid} is ${repair.status} using ${repair.strategy}; signals: ${repair.signals.join(', ') || 'none'}.`;
  }

  private static normalize(value: string): string[] {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  private static extractSignals(tokens: string[]): string[] {
    const signalTerms = new Set([
      'dismissive',
      'evasive',
      'contradictory',
      'inconsistent',
      'unsafe',
      'coercive',
      'manipulative',
      'unreliable',
      'opaque',
      'harmful',
    ]);

    return tokens.filter(token => signalTerms.has(token));
  }

  private static calculateContradictionScore(expected: string[], observed: string[], signals: string[]): number {
    const expectedSet = new Set(expected);
    const observedSet = new Set(observed);
    const overlap = [...expectedSet].filter(token => observedSet.has(token)).length;
    const denominator = Math.max(expectedSet.size, 1);
    const distance = 1 - overlap / denominator;
    const signalBoost = Math.min(signals.length * 0.15, 0.45);
    return distance * 0.65 + signalBoost;
  }

  private static requiredWaitForStrategy(strategy: RepairStrategy): number {
    const hour = 60 * 60 * 1000;
    switch (strategy) {
      case 'transparency':
        return hour;
      case 'reset':
        return 24 * hour;
      case 'remediation':
        return 72 * hour;
      case 'escalation':
        return 7 * 24 * hour;
    }
  }
}
