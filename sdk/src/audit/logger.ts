import { randomUUID, sha256Hex } from '../lib/crypto.js';
import type { AuditEvent, AuditEventInput, AuditReceipt, AuditStats, ExportFormat } from '../types/index.js';

export class AuditLogger {
  private readonly events: AuditEvent[] = [];

  static createEvent(input: AuditEventInput): AuditEventInput {
    if (input.ctid.trim().length === 0) throw new Error('ctid is required');
    if (input.eventType.trim().length === 0) throw new Error('eventType is required');
    if (input.operator.trim().length === 0) throw new Error('operator is required');

    return {
      ctid: input.ctid,
      eventType: input.eventType,
      operator: input.operator,
      payload: { ...input.payload },
    };
  }

  log(input: AuditEventInput): AuditEvent {
    const previous = this.events.at(-1);
    const event: AuditEvent = {
      id: `evt-${randomUUID()}`,
      ctid: input.ctid,
      eventType: input.eventType,
      operator: input.operator,
      payload: { ...input.payload },
      timestamp: new Date(),
      sequence: this.events.length + 1,
      signature: '',
    };

    if (previous?.signature !== undefined) {
      event.previousSignature = previous.signature;
    }

    event.signature = AuditLogger.signEvent(event);
    this.events.push(event);
    return AuditLogger.cloneEvent(event);
  }

  getAllEvents(): AuditEvent[] {
    return this.events.map(AuditLogger.cloneEvent);
  }

  getEventsByCTID(ctid: string): AuditEvent[] {
    return this.events.filter(event => event.ctid === ctid).map(AuditLogger.cloneEvent);
  }

  getEventsByType(eventType: string): AuditEvent[] {
    return this.events.filter(event => event.eventType === eventType).map(AuditLogger.cloneEvent);
  }

  getEventsByTimeRange(start: Date, end: Date): AuditEvent[] {
    return this.events
      .filter(event => event.timestamp.getTime() >= start.getTime() && event.timestamp.getTime() <= end.getTime())
      .map(AuditLogger.cloneEvent);
  }

  export(format: ExportFormat): string {
    if (format === 'json') {
      return JSON.stringify(this.events, null, 2);
    }

    const headers = ['id', 'sequence', 'timestamp', 'ctid', 'eventType', 'operator', 'signature', 'previousSignature'];
    const rows = this.events.map(event => [
      event.id,
      String(event.sequence),
      event.timestamp.toISOString(),
      event.ctid,
      event.eventType,
      event.operator,
      event.signature,
      event.previousSignature ?? '',
    ].map(AuditLogger.escapeCsv).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  getStats(): AuditStats {
    const uniqueCTIDs = new Set(this.events.map(event => event.ctid)).size;
    const eventTypes: Record<string, number> = {};

    for (const event of this.events) {
      eventTypes[event.eventType] = (eventTypes[event.eventType] ?? 0) + 1;
    }

    const stats: AuditStats = {
      totalEvents: this.events.length,
      uniqueCTIDs,
      eventTypes,
    };

    const first = this.events[0];
    const last = this.events.at(-1);
    if (first !== undefined) stats.firstEventAt = new Date(first.timestamp);
    if (last !== undefined) stats.lastEventAt = new Date(last.timestamp);

    return stats;
  }

  verifyIntegrity(): boolean {
    return AuditLogger.verifyEventsIntegrity(this.events);
  }

  getReceipt(eventId: string): AuditReceipt | undefined {
    const event = this.events.find(candidate => candidate.id === eventId);
    if (event === undefined) return undefined;

    return {
      eventId: event.id,
      ctid: event.ctid,
      eventType: event.eventType,
      timestamp: new Date(event.timestamp),
      sequence: event.sequence,
      signature: event.signature,
      receipt: `EIS receipt ${event.id} sequence ${event.sequence} signed ${event.signature}`,
    };
  }

  static verifyEventsIntegrity(events: AuditEvent[]): boolean {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event === undefined) return false;

      const expectedSequence = index + 1;
      if (event.sequence !== expectedSequence) return false;

      const previous = index > 0 ? events[index - 1] : undefined;
      const expectedPrevious = previous?.signature;
      if ((event.previousSignature ?? undefined) !== expectedPrevious) return false;

      if (AuditLogger.signEvent(event) !== event.signature) return false;
    }

    return true;
  }

  static signEvent(event: AuditEvent): string {
    const signable = {
      id: event.id,
      ctid: event.ctid,
      eventType: event.eventType,
      operator: event.operator,
      payload: event.payload,
      timestamp: event.timestamp.toISOString(),
      sequence: event.sequence,
      previousSignature: event.previousSignature ?? null,
    };

    return sha256Hex(AuditLogger.stableStringify(signable));
  }

  private static stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return `[${value.map(item => AuditLogger.stableStringify(item)).join(',')}]`;

    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${AuditLogger.stableStringify(object[key])}`).join(',')}}`;
  }

  private static cloneEvent(event: AuditEvent): AuditEvent {
    const cloned: AuditEvent = {
      ...event,
      timestamp: new Date(event.timestamp),
      payload: { ...event.payload },
    };

    if (event.previousSignature === undefined) {
      delete cloned.previousSignature;
    }

    return cloned;
  }

  private static escapeCsv(value: string): string {
    if (/[",\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
