# Changelog

## Unreleased

### Changed

- Replaced all `node:crypto` usage with dependency-free, cross-runtime
  primitives in `src/lib/crypto.ts`: `randomUUID()` now prefers the standard
  `globalThis.crypto.randomUUID()` / `.getRandomValues()` (Node >=20, all
  evergreen browsers, edge/Workers runtimes), and hashing now uses a pure-JS,
  synchronous SHA-256 implementation (`src/lib/sha256.ts`, verified against
  NIST test vectors and cross-checked against `node:crypto`'s own output) so
  ID and signature generation stay synchronous and portable without a native
  binding. No public API changed as a result.
- Raised the minimum supported Node version to `>=20` (Node 18 reached its
  own end of life in April 2025) so the WebCrypto globals above are always
  present without a runtime branch.
- Expanded test coverage across the consent, audit, and repair modules from
  a single smoke-test file (~44% statements / 18% branches) to full
  per-module suites (99%+ statements, 98%+ branches) and added a
  `coverageThreshold` gate to `jest.config.js` so it can't silently regress.

## 0.2.0 — Release candidate prepared: June 25, 2026

Initial release-candidate implementation of the Emotional Infrastructure™ Standard SDK.

### Added

- Consent Token ID generation and validation.
- Consent lifecycle state machine.
- Tolerance window management.
- Append-only audit logger.
- Audit event signature verification.
- Trace validation and gap detection.
- Trust rupture detection.
- Trust delta creation.
- Repair strategy recommendation.
- Repair workflow lifecycle utilities.
