# EIS SDK v0.2.0 Release Notes

## Release status

This release should be treated as a release candidate until the complete source repository passes public CI verification.

## Summary

EIS SDK v0.2.0 introduces the first public implementation layer for Emotional Infrastructure™ governance. The SDK provides TypeScript primitives for consent lifecycle management, audit traceability, tolerance windows, trace validation, and trust repair.

## Highlights

- Consent Token ID creation and validation
- Consent state machine for lifecycle enforcement
- Tolerance window manager for temporal and behavioral boundaries
- Append-only audit logger
- Event signature support
- Audit export to JSON/CSV
- Trace validation and gap detection
- Trust rupture detection
- Trust delta tracking
- Repair strategy recommendation
- Re-engagement readiness assessment

## Known production boundaries

This release does not include:

- Persistence layer
- Encryption layer
- Authentication or authorization
- Hosted API
- UI dashboard
- Deployment infrastructure

Those components are intentionally outside the SDK boundary and should be implemented by the integrating system or future EIS runtime packages.

## Recommended verification

Before publishing to npm:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

## Next roadmap target

EIS Runtime API v0.1.0:

- HTTP API for consent registration, revocation, audit logging, trace validation, and repair workflows
- PostgreSQL support
- JWT-based authentication
- OpenAPI documentation
- Docker deployment
