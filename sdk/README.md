# Emotional Infrastructure™ Standard SDK

**Package:** `@emotional-infrastructure/sdk`  
**Version:** `0.2.0`  
**Author:** Brittany Wright  
**License:** Apache-2.0  
**Status:** Release candidate  
**Release candidate prepared:** June 25, 2026

The Emotional Infrastructure™ Standard SDK is a TypeScript governance library for implementing consent lifecycle management, audit traceability, tolerance windows, and trust repair workflows in adaptive AI systems.

It is designed as an implementation layer for AI-mediated trust environments: systems where consent, disclosure, reliance, adaptation, and repair need to be represented as auditable runtime artifacts rather than abstract principles.

## Core modules

| Module | Purpose |
|---|---|
| Consent | Consent Token IDs, lifecycle state transitions, and consent status checks |
| Tolerance Windows | Temporal and behavioral boundaries for adaptive interactions |
| Audit | Append-only event ledger, event signatures, receipts, and export |
| Trace Validation | Consistency checks, gap detection, and audit integrity validation |
| Trust Repair | Rupture detection, trust delta creation, repair strategy selection, and re-engagement assessment |

## Install

```bash
npm install @emotional-infrastructure/sdk
```

## Quick start

```typescript
import { ConsentTokenID, AuditLogger, TrustRepair } from '@emotional-infrastructure/sdk';

const token = ConsentTokenID.create({
  userId: 'user-123',
  purpose: 'ai-assisted-writing',
  scope: 'adaptation',
  expiresIn: 30 * 24 * 60 * 60 * 1000,
});

const logger = new AuditLogger();

const event = logger.log(
  AuditLogger.createEvent({
    ctid: token.ctid,
    eventType: 'consent_registered',
    operator: 'system',
    payload: { purpose: token.purpose, scope: token.scope },
  })
);

console.log(event.signature);
```

## Consent example

```typescript
import { ConsentTokenID, ConsentStateMachine } from '@emotional-infrastructure/sdk';

const token = ConsentTokenID.create({
  userId: 'user-123',
  purpose: 'model-assisted-writing',
  scope: 'adaptation',
  deterministic: true,
});

const result = ConsentStateMachine.transition(
  token,
  'pending_review',
  'User requested review of adaptive behavior',
  'system'
);

if (result.success) {
  console.log(result.token?.status);
}
```

## Tolerance window example

```typescript
import { ToleranceWindowManager } from '@emotional-infrastructure/sdk';

let window = ToleranceWindowManager.create({
  ctid: token.ctid,
  durationMs: 60 * 60 * 1000,
  interactionLimit: 100,
  behaviorThreshold: 0.75,
});

const recorded = ToleranceWindowManager.recordInteraction(window, 0.92);

if (recorded.success && recorded.window) {
  window = recorded.window;
}
```

## Audit example

```typescript
import { AuditLogger, TraceValidator } from '@emotional-infrastructure/sdk';

const logger = new AuditLogger();

logger.log(
  AuditLogger.createEvent({
    ctid: token.ctid,
    eventType: 'interaction_logged',
    operator: 'system',
    payload: { outputLength: 1280 },
  })
);

const validation = TraceValidator.validate(logger.getAllEvents());
console.log(TraceValidator.generateReport(validation));
```

## Repair example

```typescript
import { TrustRepair } from '@emotional-infrastructure/sdk';

const rupture = TrustRepair.detectRupture({
  ctid: token.ctid,
  expectedBehavior: 'helpful transparent and consistent',
  observedBehavior: 'dismissive evasive and inconsistent',
  confidenceThreshold: 0.7,
  auditTrail: logger.getAllEvents(),
});

if (rupture.detected) {
  const delta = TrustRepair.createDelta({
    ctid: token.ctid,
    before: 'positive',
    after: 'negative',
    cause: rupture.reasoning,
    reversible: false,
  });

  const severity = TrustRepair.evaluateSeverity(delta);
  const strategy = TrustRepair.recommendStrategy({
    ctid: token.ctid,
    severity,
    reversible: delta.reversible,
    priorRepairAttempts: 0,
    auditTrailLength: logger.getAllEvents().length,
  });

  const repair = TrustRepair.initiateRepair({
    ctid: token.ctid,
    detectedAt: new Date(),
    signals: rupture.signals,
    strategy,
    auditTrail: logger.getAllEvents(),
  });

  console.log(TrustRepair.summarizeRepair(repair));
}
```

## Architecture

```text
Consent Layer
├── Consent Token ID
├── Consent State Machine
└── Tolerance Window Manager
        ↓
Audit Layer
├── Append-Only Event Logger
└── Trace Validator
        ↓
Repair Layer
├── Rupture Detection
├── Trust Delta Tracking
└── Repair Strategy Selection
```

## Production boundary

This SDK provides governance primitives. It does not include persistence, encryption, authentication, authorization, hosted APIs, UI components, or deployment infrastructure. Those should be implemented by the integrating system or future EIS runtime packages.

Recommended production integrations:

- Durable database for tokens, windows, events, deltas, and repairs.
- Public-key signing for audit events.
- Authentication and authorization around consent and audit endpoints.
- Retention and minimization policies for audit payloads.
- Human review workflows for severe ruptures.
- Dashboard for consent state, audit traces, and repair lifecycle.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

## Trademark

Emotional Infrastructure™ is a trademark of Brittany Wright.

## License

Apache License 2.0.
