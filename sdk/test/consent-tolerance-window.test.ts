import { ToleranceWindowManager } from '../src/consent/toleranceWindow.js';
import type { ToleranceWindow } from '../src/types/index.js';

function makeWindow(overrides: Partial<Parameters<typeof ToleranceWindowManager.create>[0]> = {}): ToleranceWindow {
  return ToleranceWindowManager.create({
    ctid: 'ctid-test',
    durationMs: 60_000,
    interactionLimit: 3,
    behaviorThreshold: 0.5,
    ...overrides,
  });
}

describe('ToleranceWindowManager', () => {
  test('create validates durationMs, interactionLimit, and behaviorThreshold', () => {
    expect(() => makeWindow({ durationMs: 0 })).toThrow('durationMs must be greater than zero');
    expect(() => makeWindow({ interactionLimit: 0 })).toThrow('interactionLimit must be greater than zero');
    expect(() => makeWindow({ behaviorThreshold: -0.1 })).toThrow('behaviorThreshold must be between 0 and 1');
    expect(() => makeWindow({ behaviorThreshold: 1.1 })).toThrow('behaviorThreshold must be between 0 and 1');
  });

  test('create returns an open window with zeroed counters', () => {
    const window = makeWindow();
    expect(window.status).toBe('open');
    expect(window.interactionCount).toBe(0);
    expect(window.behaviorScores).toEqual([]);
    expect(window.expiresAt.getTime()).toBe(window.startsAt.getTime() + window.durationMs);
  });

  test('recordInteraction rejects an out-of-range behaviorScore', () => {
    const window = makeWindow();
    expect(ToleranceWindowManager.recordInteraction(window, -0.1).success).toBe(false);
    expect(ToleranceWindowManager.recordInteraction(window, 1.1).success).toBe(false);
  });

  test('recordInteraction rejects a score below the tolerance threshold', () => {
    const window = makeWindow({ behaviorThreshold: 0.7 });
    const result = ToleranceWindowManager.recordInteraction(window, 0.5);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Behavior score is below tolerance threshold');
  });

  test('recordInteraction rejects once the window has expired', () => {
    const window = makeWindow({ durationMs: 1 });
    const later = new Date(window.expiresAt.getTime() + 1);
    const result = ToleranceWindowManager.recordInteraction(window, 0.9, later);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tolerance window is expired');
  });

  test('recordInteraction rejects once the window is closed', () => {
    const window = ToleranceWindowManager.close(makeWindow());
    const result = ToleranceWindowManager.recordInteraction(window, 0.9);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tolerance window is closed');
  });

  test('recordInteraction flips to exceeded once the limit is reached', () => {
    let window = makeWindow({ interactionLimit: 2 });
    const first = ToleranceWindowManager.recordInteraction(window, 0.9);
    expect(first.success).toBe(true);
    window = first.window!;
    expect(window.status).toBe('open');

    const second = ToleranceWindowManager.recordInteraction(window, 0.9);
    expect(second.success).toBe(true);
    expect(second.window?.status).toBe('exceeded');
  });

  test('recordInteraction rejects once already exceeded', () => {
    let window = makeWindow({ interactionLimit: 1 });
    window = ToleranceWindowManager.recordInteraction(window, 0.9).window!;
    expect(window.status).toBe('exceeded');

    const result = ToleranceWindowManager.recordInteraction(window, 0.9);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Tolerance window is exceeded');
  });

  test('getRemainingCapacity and getFillRatio track interaction count', () => {
    let window = makeWindow({ interactionLimit: 4 });
    expect(ToleranceWindowManager.getRemainingCapacity(window)).toBe(4);
    expect(ToleranceWindowManager.getFillRatio(window)).toBe(0);

    window = ToleranceWindowManager.recordInteraction(window, 0.9).window!;
    expect(ToleranceWindowManager.getRemainingCapacity(window)).toBe(3);
    expect(ToleranceWindowManager.getFillRatio(window)).toBeCloseTo(0.25);
  });

  test('getAverageBehaviorScore is undefined with no interactions and averages otherwise', () => {
    let window = makeWindow();
    expect(ToleranceWindowManager.getAverageBehaviorScore(window)).toBeUndefined();

    window = ToleranceWindowManager.recordInteraction(window, 0.6).window!;
    window = ToleranceWindowManager.recordInteraction(window, 1.0).window!;
    expect(ToleranceWindowManager.getAverageBehaviorScore(window)).toBeCloseTo(0.8);
  });

  test('getStatusSummary reports status, remaining capacity, and behavior average', () => {
    const window = makeWindow();
    const summary = ToleranceWindowManager.getStatusSummary(window);
    expect(summary).toContain('is open');
    expect(summary).toContain('no behavior scores recorded');
  });

  test('getStatusSummary reports the average once interactions are recorded', () => {
    const window = ToleranceWindowManager.recordInteraction(makeWindow(), 0.8).window!;
    const summary = ToleranceWindowManager.getStatusSummary(window);
    expect(summary).toContain('average behavior score 80.0%');
  });

  test('extend adds duration and reopens an expired window', () => {
    const window = makeWindow({ durationMs: 1000 });
    const extended = ToleranceWindowManager.extend(window, 5000);
    expect(extended.durationMs).toBe(6000);
    expect(extended.expiresAt.getTime()).toBe(window.expiresAt.getTime() + 5000);

    const expiredWindow: ToleranceWindow = { ...window, status: 'expired' };
    expect(ToleranceWindowManager.extend(expiredWindow, 1000).status).toBe('open');
  });

  test('extend rejects a non-positive additionalMs', () => {
    expect(() => ToleranceWindowManager.extend(makeWindow(), 0)).toThrow('additionalMs must be greater than zero');
  });

  test('increaseLimit raises the cap and reopens an exceeded window if capacity allows', () => {
    let window = makeWindow({ interactionLimit: 1 });
    window = ToleranceWindowManager.recordInteraction(window, 0.9).window!;
    expect(window.status).toBe('exceeded');

    const increased = ToleranceWindowManager.increaseLimit(window, 2);
    expect(increased.interactionLimit).toBe(3);
    expect(increased.status).toBe('open');
  });

  test('increaseLimit on a still-open window leaves its status untouched', () => {
    const window = makeWindow({ interactionLimit: 5 });
    const increased = ToleranceWindowManager.increaseLimit(window, 2);
    expect(increased.status).toBe('open');
    expect(increased.interactionLimit).toBe(7);
  });

  test('increaseLimit rejects a non-positive amount', () => {
    expect(() => ToleranceWindowManager.increaseLimit(makeWindow(), -1)).toThrow(
      'additionalInteractions must be greater than zero'
    );
  });

  test('close sets status, closedAt, and a default or custom reason', () => {
    const closed = ToleranceWindowManager.close(makeWindow());
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(closed.statusReason).toBe('Closed by operator');

    const closedWithReason = ToleranceWindowManager.close(makeWindow(), 'policy violation');
    expect(closedWithReason.statusReason).toBe('policy violation');
  });

  test('getOperationalStatus prioritizes closed over expiry/limit checks', () => {
    const window = ToleranceWindowManager.close(makeWindow({ durationMs: 1 }));
    expect(ToleranceWindowManager.getOperationalStatus(window)).toBe('closed');
  });
});
