import { AuditLogger } from '../src/audit/logger.js';

function logSample(logger: AuditLogger, ctid = 'ctid-1', eventType = 'interaction_logged') {
  return logger.log(AuditLogger.createEvent({ ctid, eventType, operator: 'system', payload: { n: 1 } }));
}

describe('AuditLogger.createEvent', () => {
  test('rejects blank ctid, eventType, or operator', () => {
    expect(() => AuditLogger.createEvent({ ctid: '', eventType: 'x', operator: 'o', payload: {} })).toThrow(
      'ctid is required'
    );
    expect(() => AuditLogger.createEvent({ ctid: 'c', eventType: ' ', operator: 'o', payload: {} })).toThrow(
      'eventType is required'
    );
    expect(() => AuditLogger.createEvent({ ctid: 'c', eventType: 'x', operator: '', payload: {} })).toThrow(
      'operator is required'
    );
  });

  test('copies the payload rather than aliasing it', () => {
    const payload = { a: 1 };
    const input = AuditLogger.createEvent({ ctid: 'c', eventType: 'x', operator: 'o', payload });
    payload.a = 2;
    expect(input.payload.a).toBe(1);
  });
});

describe('AuditLogger', () => {
  test('log assigns sequential sequence numbers and chains previousSignature', () => {
    const logger = new AuditLogger();
    const first = logSample(logger);
    const second = logSample(logger);

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(first.previousSignature).toBeUndefined();
    expect(second.previousSignature).toBe(first.signature);
    expect(second.signature).not.toBe(first.signature);
  });

  test('getAllEvents / getEventsByCTID / getEventsByType return independent clones', () => {
    const logger = new AuditLogger();
    logSample(logger, 'ctid-a', 'consent_registered');
    logSample(logger, 'ctid-b', 'interaction_logged');

    const all = logger.getAllEvents();
    all[0]!.eventType = 'tampered';
    expect(logger.getAllEvents()[0]!.eventType).toBe('consent_registered');

    expect(logger.getEventsByCTID('ctid-a')).toHaveLength(1);
    expect(logger.getEventsByType('interaction_logged')).toHaveLength(1);
    expect(logger.getEventsByCTID('nonexistent')).toHaveLength(0);
  });

  test('getEventsByTimeRange filters inclusively', () => {
    const logger = new AuditLogger();
    const event = logSample(logger);
    const start = new Date(event.timestamp.getTime() - 1000);
    const end = new Date(event.timestamp.getTime() + 1000);
    expect(logger.getEventsByTimeRange(start, end)).toHaveLength(1);
    expect(logger.getEventsByTimeRange(end, end)).toHaveLength(0);
  });

  test('export(json) round-trips the event data', () => {
    const logger = new AuditLogger();
    logSample(logger);
    const json = logger.export('json');
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].eventType).toBe('interaction_logged');
  });

  test('export(csv) includes a header row and escapes commas/quotes/newlines', () => {
    const logger = new AuditLogger();
    logger.log(
      AuditLogger.createEvent({
        ctid: 'c,1',
        eventType: 'note "quoted"',
        operator: 'line\nbreak',
        payload: {},
      })
    );
    const csv = logger.export('csv');
    expect(csv.startsWith('id,sequence,timestamp,ctid,eventType,operator,signature,previousSignature\n')).toBe(true);
    expect(csv).toContain('"c,1"');
    expect(csv).toContain('"note ""quoted"""');
    expect(csv).toContain('"line\nbreak"');
  });

  test('getStats summarizes counts, unique CTIDs, and first/last timestamps', () => {
    const logger = new AuditLogger();
    expect(logger.getStats().totalEvents).toBe(0);
    expect(logger.getStats().firstEventAt).toBeUndefined();

    logSample(logger, 'ctid-a', 'consent_registered');
    logSample(logger, 'ctid-a', 'interaction_logged');
    logSample(logger, 'ctid-b', 'interaction_logged');

    const stats = logger.getStats();
    expect(stats.totalEvents).toBe(3);
    expect(stats.uniqueCTIDs).toBe(2);
    expect(stats.eventTypes).toEqual({ consent_registered: 1, interaction_logged: 2 });
    expect(stats.firstEventAt).toBeInstanceOf(Date);
    expect(stats.lastEventAt).toBeInstanceOf(Date);
  });

  test('verifyIntegrity is true for an untouched log and false after tampering', () => {
    const logger = new AuditLogger();
    logSample(logger);
    logSample(logger);
    expect(logger.verifyIntegrity()).toBe(true);

    const tampered = logger.getAllEvents();
    tampered[1]!.eventType = 'forged';
    expect(AuditLogger.verifyEventsIntegrity(tampered)).toBe(false);
  });

  test('verifyEventsIntegrity catches a broken sequence and a broken previousSignature link', () => {
    const logger = new AuditLogger();
    logSample(logger);
    logSample(logger);
    const events = logger.getAllEvents();

    const brokenSequence = [{ ...events[0]!, sequence: 5 }, events[1]!];
    expect(AuditLogger.verifyEventsIntegrity(brokenSequence)).toBe(false);

    const brokenLink = [events[0]!, { ...events[1]!, previousSignature: 'wrong' }];
    expect(AuditLogger.verifyEventsIntegrity(brokenLink)).toBe(false);
  });

  test('signs successfully when the payload contains a raw Date value', () => {
    const logger = new AuditLogger();
    const event = logger.log(
      AuditLogger.createEvent({ ctid: 'c', eventType: 'x', operator: 'o', payload: { occurredAt: new Date('2026-01-01T00:00:00Z') } })
    );
    expect(event.signature).toHaveLength(64);
    expect(AuditLogger.verifyEventsIntegrity([event])).toBe(true);
  });

  test('signs successfully when the payload contains an array value', () => {
    const logger = new AuditLogger();
    const event = logger.log(
      AuditLogger.createEvent({ ctid: 'c', eventType: 'x', operator: 'o', payload: { tags: ['a', 'b', 3] } })
    );
    expect(event.signature).toHaveLength(64);
    expect(AuditLogger.verifyEventsIntegrity([event])).toBe(true);
  });

  test('getReceipt returns a receipt for a known event and undefined otherwise', () => {
    const logger = new AuditLogger();
    const event = logSample(logger);

    const receipt = logger.getReceipt(event.id);
    expect(receipt?.eventId).toBe(event.id);
    expect(receipt?.receipt).toContain(event.id);

    expect(logger.getReceipt('missing')).toBeUndefined();
  });
});
