import { AuditLogger } from '../src/audit/logger.js';
import { TraceValidator } from '../src/audit/index.js';
import type { AuditEvent } from '../src/types/index.js';

function seedLogger(): AuditLogger {
  const logger = new AuditLogger();
  logger.log(AuditLogger.createEvent({ ctid: 'ctid-a', eventType: 'consent_registered', operator: 'system', payload: {} }));
  logger.log(AuditLogger.createEvent({ ctid: 'ctid-a', eventType: 'interaction_logged', operator: 'system', payload: {} }));
  return logger;
}

describe('TraceValidator.validate', () => {
  test('a clean, signed trace is valid with no errors or warnings', () => {
    const result = TraceValidator.validate(seedLogger().getAllEvents());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.eventCount).toBe(2);
  });

  test('flags a duplicate event id', () => {
    const events = seedLogger().getAllEvents();
    events[1]!.id = events[0]!.id;
    const result = TraceValidator.validate(events);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate event id'))).toBe(true);
  });

  test('flags an out-of-order sequence number', () => {
    const events = seedLogger().getAllEvents();
    events[1]!.sequence = 5;
    const result = TraceValidator.validate(events);
    expect(result.errors.some(e => e.includes('Invalid sequence'))).toBe(true);
  });

  test('warns (but does not error) when timestamps move backwards', () => {
    const events = seedLogger().getAllEvents();
    events[1]!.timestamp = new Date(events[0]!.timestamp.getTime() - 10_000);
    const result = TraceValidator.validate(events);
    expect(result.warnings.some(w => w.includes('Timestamp moved backwards'))).toBe(true);
  });

  test('flags a broken signature chain', () => {
    const events = seedLogger().getAllEvents();
    events[0]!.payload = { tampered: true };
    const result = TraceValidator.validate(events);
    expect(result.errors).toContain('Audit signature chain verification failed');
  });
});

describe('TraceValidator.validateEventShape', () => {
  const base: AuditEvent = {
    id: 'evt-1',
    ctid: 'ctid-1',
    eventType: 'x',
    operator: 'o',
    payload: {},
    timestamp: new Date(),
    sequence: 1,
    signature: 'sig',
  };

  test('reports every missing/invalid field independently', () => {
    expect(TraceValidator.validateEventShape({ ...base, id: '' })).toContain('id is required');
    expect(TraceValidator.validateEventShape({ ...base, ctid: '' })).toContain('ctid is required');
    expect(TraceValidator.validateEventShape({ ...base, eventType: '' })).toContain('eventType is required');
    expect(TraceValidator.validateEventShape({ ...base, operator: '' })).toContain('operator is required');
    expect(TraceValidator.validateEventShape({ ...base, timestamp: 'not-a-date' as unknown as Date })).toContain(
      'timestamp must be a Date'
    );
    expect(TraceValidator.validateEventShape({ ...base, sequence: 0 })).toContain(
      'sequence must be a positive integer'
    );
    expect(TraceValidator.validateEventShape({ ...base, signature: '' })).toContain('signature is required');
  });

  test('a well-formed event has no shape errors', () => {
    expect(TraceValidator.validateEventShape(base)).toEqual([]);
  });
});

describe('TraceValidator.detectGaps', () => {
  function makeEvent(id: string, timestamp: Date): AuditEvent {
    return {
      id,
      ctid: 'ctid-a',
      eventType: 'interaction_logged',
      operator: 'system',
      payload: {},
      timestamp,
      sequence: 1,
      signature: 'sig',
    };
  }

  test('finds gaps larger than the threshold and ignores smaller ones', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: AuditEvent[] = [
      makeEvent('a', t0),
      makeEvent('b', new Date(t0.getTime() + 1000)),
      makeEvent('c', new Date(t0.getTime() + 100_000)),
    ];

    const gaps = TraceValidator.detectGaps(events, 5000);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.fromEventId).toBe('b');
    expect(gaps[0]!.toEventId).toBe('c');
    expect(gaps[0]!.gapMs).toBe(99_000);
  });
});

describe('TraceValidator.groupByCTID / findOrphanEvents', () => {
  test('groups events by ctid', () => {
    const events = seedLogger().getAllEvents();
    const groups = TraceValidator.groupByCTID(events);
    expect(groups.get('ctid-a')).toHaveLength(2);
  });

  test('flags a ctid with no consent_* event as orphaned', () => {
    const logger = new AuditLogger();
    logger.log(AuditLogger.createEvent({ ctid: 'ctid-orphan', eventType: 'interaction_logged', operator: 'system', payload: {} }));
    const orphans = TraceValidator.findOrphanEvents(logger.getAllEvents());
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.ctid).toBe('ctid-orphan');
  });

  test('does not flag a ctid that has a consent_* event', () => {
    const orphans = TraceValidator.findOrphanEvents(seedLogger().getAllEvents());
    expect(orphans).toHaveLength(0);
  });
});

describe('TraceValidator.generateReport', () => {
  test('renders a VALID report with no error/warning detail sections', () => {
    const result = TraceValidator.validate(seedLogger().getAllEvents());
    const report = TraceValidator.generateReport(result);
    expect(report).toContain('Trace status: VALID');
    expect(report).not.toContain('Error details:');
  });

  test('renders an INVALID report with error and warning detail sections', () => {
    const events = seedLogger().getAllEvents();
    events[1]!.sequence = 99;
    events[1]!.timestamp = new Date(events[0]!.timestamp.getTime() - 1000);
    const result = TraceValidator.validate(events);
    const report = TraceValidator.generateReport(result);
    expect(report).toContain('Trace status: INVALID');
    expect(report).toContain('Error details:');
    expect(report).toContain('Warning details:');
  });
});
