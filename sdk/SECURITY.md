# Security Policy

## Scope

The EIS SDK provides governance primitives for consent, audit traceability, tolerance windows, and trust repair workflows. It does not provide hosted infrastructure, authentication, authorization, persistence, encryption, or production key management.

## Production recommendations

- Use durable storage for consent tokens, audit events, and repair workflows.
- Use public-key signatures for audit events in production deployments.
- Encrypt sensitive audit payloads at rest and in transit.
- Apply authentication and authorization to all consent and audit endpoints.
- Define retention and deletion policies before collecting user-associated telemetry.
- Avoid placing raw sensitive user content in audit payloads unless legally and operationally necessary.

## Reporting security issues

Open a private security advisory in the repository or contact the maintainer through the official project channel.
