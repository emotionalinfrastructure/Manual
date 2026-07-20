# EIS Runtime API Build Plan

## Objective

Create a reference runtime API that wraps the EIS SDK and exposes governance operations through authenticated HTTP endpoints.

## Proposed stack

- Node.js + Fastify or Express
- TypeScript
- PostgreSQL
- Prisma or Drizzle ORM
- JWT authentication
- OpenAPI documentation
- Docker Compose for local deployment

## API endpoints

### Consent

```http
POST /v1/consent/register
POST /v1/consent/revoke
POST /v1/consent/suspend
GET  /v1/consent/:ctid
```

### Tolerance windows

```http
POST /v1/windows/create
POST /v1/windows/:windowId/interaction
GET  /v1/windows/:windowId/status
```

### Audit

```http
POST /v1/audit/events
GET  /v1/audit/events/:eventId
GET  /v1/audit/ctid/:ctid
GET  /v1/audit/export?format=json|csv
POST /v1/audit/verify
```

### Repair

```http
POST /v1/repair/detect
POST /v1/repair/initiate
POST /v1/repair/complete
GET  /v1/repair/:repairId
```

### System

```http
GET /health
GET /version
GET /openapi.json
```

## Database tables

- `consent_tokens`
- `tolerance_windows`
- `audit_events`
- `trust_deltas`
- `repair_workflows`
- `api_keys`
- `users`

## Release target

EIS Runtime API v0.1.0 should be positioned as a reference implementation, not the final enterprise platform.
