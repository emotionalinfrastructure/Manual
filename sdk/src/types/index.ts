export type ConsentStatus = 'active' | 'suspended' | 'revoked' | 'expired' | 'pending_review';
export type ToleranceWindowStatus = 'open' | 'closed' | 'exceeded' | 'expired';
export type RepairSeverity = 'low' | 'medium' | 'high' | 'critical';
export type RepairStrategy = 'transparency' | 'reset' | 'escalation' | 'remediation';
export type TrustState = 'positive' | 'neutral' | 'negative' | 'unknown';
export type ExportFormat = 'json' | 'csv';

export interface Result<T> {
  success: boolean;
  value?: T;
  error?: string;
}

export interface ConsentTokenInput {
  userId: string;
  purpose: string;
  scope: string;
  expiresIn?: number;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
  deterministic?: boolean;
}

export interface ConsentTokenIDInput {
  userId: string;
  purpose: string;
  scope: string;
  deterministic?: boolean;
}

export interface ConsentToken {
  ctid: string;
  userId: string;
  purpose: string;
  scope: string;
  createdAt: Date;
  expiresAt?: Date;
  status: ConsentStatus;
  metadata: Record<string, unknown>;
  updatedAt?: Date;
  statusReason?: string;
  suspendedUntil?: Date;
  lastOperator?: string;
}

export interface ConsentTransitionResult {
  success: boolean;
  token?: ConsentToken;
  error?: string;
}

export interface ToleranceWindowInput {
  ctid: string;
  durationMs: number;
  interactionLimit: number;
  behaviorThreshold: number;
}

export interface ToleranceWindow {
  id: string;
  ctid: string;
  startsAt: Date;
  expiresAt: Date;
  durationMs: number;
  interactionLimit: number;
  interactionCount: number;
  behaviorThreshold: number;
  behaviorScores: number[];
  status: ToleranceWindowStatus;
  closedAt?: Date;
  statusReason?: string;
}

export interface ToleranceWindowRecordResult {
  success: boolean;
  window?: ToleranceWindow;
  error?: string;
}

export interface AuditEventInput {
  ctid: string;
  eventType: string;
  operator: string;
  payload: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  ctid: string;
  eventType: string;
  operator: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  sequence: number;
  previousSignature?: string;
  signature: string;
}

export interface AuditReceipt {
  eventId: string;
  ctid: string;
  eventType: string;
  timestamp: Date;
  sequence: number;
  signature: string;
  receipt: string;
}

export interface AuditStats {
  totalEvents: number;
  uniqueCTIDs: number;
  eventTypes: Record<string, number>;
  firstEventAt?: Date;
  lastEventAt?: Date;
}

export interface TraceGap {
  fromEventId: string;
  toEventId: string;
  fromTimestamp: Date;
  toTimestamp: Date;
  gapMs: number;
}

export interface TraceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  eventCount: number;
}

export interface RuptureDetectionInput {
  ctid: string;
  expectedBehavior: string;
  observedBehavior: string;
  confidenceThreshold: number;
  auditTrail: AuditEvent[];
}

export interface RuptureDetectionResult {
  detected: boolean;
  confidence: number;
  reasoning: string;
  signals: string[];
}

export interface TrustDeltaInput {
  ctid: string;
  before: TrustState;
  after: TrustState;
  cause: string;
  reversible?: boolean;
}

export interface TrustDelta {
  id: string;
  ctid: string;
  before: TrustState;
  after: TrustState;
  cause: string;
  reversible: boolean;
  createdAt: Date;
}

export interface RepairRecommendationInput {
  ctid: string;
  severity: RepairSeverity;
  reversible: boolean;
  priorRepairAttempts: number;
  auditTrailLength: number;
}

export interface RepairInitiationInput {
  ctid: string;
  detectedAt: Date;
  signals: string[];
  strategy: RepairStrategy;
  auditTrail: AuditEvent[];
}

export interface TrustRepairContext {
  id: string;
  ctid: string;
  detectedAt: Date;
  initiatedAt: Date;
  signals: string[];
  strategy: RepairStrategy;
  auditTrailLength: number;
  status: 'initiated' | 'executed' | 'completed' | 'failed';
  outcome?: string;
  completedAt?: Date;
}

export interface RepairExecutionOutcome {
  success: boolean;
  outcome: string;
  nextAction: string;
}

export interface ReEngagementAssessment {
  ready: boolean;
  recommendation: string;
  requiredWaitMs: number;
  elapsedMs: number;
}
