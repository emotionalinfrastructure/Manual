import type { AuditEvent, TraceGap, TraceValidationResult } from '../types/index.js';
import { AuditLogger } from './logger.js';

export { AuditLogger } from './logger.js';

export class TraceValidator {
  static validate(events: AuditEvent[]): TraceValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ids = new Set<string>();

    events.forEach((event, index) => {
      const shapeErrors = TraceValidator.validateEventShape(event);
      errors.push(...shapeErrors.map(error => `Event ${index + 1}: ${error}`));

      if (ids.has(event.id)) errors.push(`Duplicate event id: ${event.id}`);
      ids.add(event.id);

      if (event.sequence !== index + 1) {
        errors.push(`Invalid sequence at event ${event.id}: expected ${index + 1}, received ${event.sequence}`);
      }

      if (index > 0) {
        const previous = events[index - 1];
        if (previous !== undefined && event.timestamp.getTime() < previous.timestamp.getTime()) {
          warnings.push(`Timestamp moved backwards at event ${event.id}`);
        }
      }
    });

    if (!TraceValidator.verifySignatures(events)) {
      errors.push('Audit signature chain verification failed');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      eventCount: events.length,
    };
  }

  static validateEventShape(event: AuditEvent): string[] {
    const errors: string[] = [];
    if (event.id.trim().length === 0) errors.push('id is required');
    if (event.ctid.trim().length === 0) errors.push('ctid is required');
    if (event.eventType.trim().length === 0) errors.push('eventType is required');
    if (event.operator.trim().length === 0) errors.push('operator is required');
    if (!(event.timestamp instanceof Date)) errors.push('timestamp must be a Date');
    if (!Number.isInteger(event.sequence) || event.sequence < 1) errors.push('sequence must be a positive integer');
    if (event.signature.trim().length === 0) errors.push('signature is required');
    return errors;
  }

  static verifySignatures(events: AuditEvent[]): boolean {
    return AuditLogger.verifyEventsIntegrity(events);
  }

  static detectGaps(events: AuditEvent[], maxGapMs: number): TraceGap[] {
    const gaps: TraceGap[] = [];
    const sorted = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous === undefined || current === undefined) continue;

      const gapMs = current.timestamp.getTime() - previous.timestamp.getTime();
      if (gapMs > maxGapMs) {
        gaps.push({
          fromEventId: previous.id,
          toEventId: current.id,
          fromTimestamp: new Date(previous.timestamp),
          toTimestamp: new Date(current.timestamp),
          gapMs,
        });
      }
    }

    return gaps;
  }

  static groupByCTID(events: AuditEvent[]): Map<string, AuditEvent[]> {
    const groups = new Map<string, AuditEvent[]>();
    for (const event of events) {
      const current = groups.get(event.ctid) ?? [];
      current.push(event);
      groups.set(event.ctid, current);
    }
    return groups;
  }

  static findOrphanEvents(events: AuditEvent[]): AuditEvent[] {
    const grouped = TraceValidator.groupByCTID(events);
    const orphaned: AuditEvent[] = [];

    for (const ctidEvents of grouped.values()) {
      const hasConsentEvent = ctidEvents.some(event => event.eventType.startsWith('consent_'));
      if (!hasConsentEvent) orphaned.push(...ctidEvents);
    }

    return orphaned;
  }

  static generateReport(validation: TraceValidationResult): string {
    const status = validation.valid ? 'VALID' : 'INVALID';
    const lines = [
      `Trace status: ${status}`,
      `Events checked: ${validation.eventCount}`,
      `Errors: ${validation.errors.length}`,
      `Warnings: ${validation.warnings.length}`,
    ];

    if (validation.errors.length > 0) {
      lines.push('Error details:');
      lines.push(...validation.errors.map(error => `- ${error}`));
    }

    if (validation.warnings.length > 0) {
      lines.push('Warning details:');
      lines.push(...validation.warnings.map(warning => `- ${warning}`));
    }

    return lines.join('\n');
  }
}
