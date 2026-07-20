import { randomUUID } from 'node:crypto';
import type { ToleranceWindow, ToleranceWindowInput, ToleranceWindowRecordResult } from '../types/index.js';

export class ToleranceWindowManager {
  static create(input: ToleranceWindowInput): ToleranceWindow {
    if (input.durationMs <= 0) throw new Error('durationMs must be greater than zero');
    if (input.interactionLimit <= 0) throw new Error('interactionLimit must be greater than zero');
    if (input.behaviorThreshold < 0 || input.behaviorThreshold > 1) {
      throw new Error('behaviorThreshold must be between 0 and 1');
    }

    const startsAt = new Date();
    return {
      id: `tw-${randomUUID()}`,
      ctid: input.ctid,
      startsAt,
      expiresAt: new Date(startsAt.getTime() + input.durationMs),
      durationMs: input.durationMs,
      interactionLimit: input.interactionLimit,
      interactionCount: 0,
      behaviorThreshold: input.behaviorThreshold,
      behaviorScores: [],
      status: 'open',
    };
  }

  static recordInteraction(window: ToleranceWindow, behaviorScore: number, now: Date = new Date()): ToleranceWindowRecordResult {
    if (behaviorScore < 0 || behaviorScore > 1) {
      return { success: false, error: 'behaviorScore must be between 0 and 1' };
    }

    const status = ToleranceWindowManager.getOperationalStatus(window, now);
    if (status !== 'open') {
      return { success: false, error: `Tolerance window is ${status}` };
    }

    if (behaviorScore < window.behaviorThreshold) {
      return { success: false, error: 'Behavior score is below tolerance threshold' };
    }

    const nextCount = window.interactionCount + 1;
    const nextWindow: ToleranceWindow = {
      ...window,
      interactionCount: nextCount,
      behaviorScores: [...window.behaviorScores, behaviorScore],
      status: nextCount >= window.interactionLimit ? 'exceeded' : 'open',
    };

    return { success: true, window: nextWindow };
  }

  static getRemainingCapacity(window: ToleranceWindow): number {
    return Math.max(window.interactionLimit - window.interactionCount, 0);
  }

  static getFillRatio(window: ToleranceWindow): number {
    return Math.min(window.interactionCount / window.interactionLimit, 1);
  }

  static getAverageBehaviorScore(window: ToleranceWindow): number | undefined {
    if (window.behaviorScores.length === 0) return undefined;
    const total = window.behaviorScores.reduce((sum, score) => sum + score, 0);
    return total / window.behaviorScores.length;
  }

  static getStatusSummary(window: ToleranceWindow, now: Date = new Date()): string {
    const status = ToleranceWindowManager.getOperationalStatus(window, now);
    const remaining = ToleranceWindowManager.getRemainingCapacity(window);
    const average = ToleranceWindowManager.getAverageBehaviorScore(window);
    const averageText = average === undefined ? 'no behavior scores recorded' : `average behavior score ${(average * 100).toFixed(1)}%`;
    return `Window ${window.id} is ${status}; ${remaining} interactions remaining; ${averageText}.`;
  }

  static extend(window: ToleranceWindow, additionalMs: number): ToleranceWindow {
    if (additionalMs <= 0) throw new Error('additionalMs must be greater than zero');
    return {
      ...window,
      durationMs: window.durationMs + additionalMs,
      expiresAt: new Date(window.expiresAt.getTime() + additionalMs),
      status: window.status === 'expired' ? 'open' : window.status,
    };
  }

  static increaseLimit(window: ToleranceWindow, additionalInteractions: number): ToleranceWindow {
    if (additionalInteractions <= 0) throw new Error('additionalInteractions must be greater than zero');
    const nextLimit = window.interactionLimit + additionalInteractions;
    return {
      ...window,
      interactionLimit: nextLimit,
      status: window.status === 'exceeded' && window.interactionCount < nextLimit ? 'open' : window.status,
    };
  }

  static close(window: ToleranceWindow, reason = 'Closed by operator'): ToleranceWindow {
    return {
      ...window,
      status: 'closed',
      closedAt: new Date(),
      statusReason: reason,
    };
  }

  static getOperationalStatus(window: ToleranceWindow, now: Date = new Date()): ToleranceWindow['status'] {
    if (window.status === 'closed') return 'closed';
    if (window.expiresAt.getTime() <= now.getTime()) return 'expired';
    if (window.interactionCount >= window.interactionLimit) return 'exceeded';
    return window.status;
  }
}
