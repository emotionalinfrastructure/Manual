# Pre-Release Documentation Fixes

## Fix 1: Date consistency

Some current materials use June 25, 2025 while the ecosystem audit uses June 25, 2026. Standardize every file to the correct release date before publishing.

Recommended wording:

```text
Release candidate prepared: June 25, 2026
```

## Fix 2: Dependency language

Do not say “zero dependencies” if `uuid` is listed under production dependencies.

Replace:

```text
Zero production dependencies
```

With:

```text
Minimal runtime dependency footprint; `uuid` is the only runtime dependency.
```

## Fix 3: Production-ready language

Until the full source passes public CI, avoid absolute production claims.

Replace:

```text
Production-ready SDK
```

With:

```text
Release candidate for a production-oriented SDK, pending public CI verification.
```

After CI passes, use:

```text
CI-verified TypeScript SDK for consent, audit, tolerance windows, and trust repair in adaptive AI systems.
```

## Fix 4: Scope clarity

Add a production boundary section to every public-facing README.

Required language:

```text
This SDK provides governance primitives. It does not include persistence, encryption, authentication, authorization, hosted APIs, UI components, or deployment infrastructure. Those should be implemented by the integrating system or future EIS runtime packages.
```

## Fix 5: Licensing language

Keep Apache-2.0 for code. Keep Emotional Infrastructure™ trademark notice separate from the open-source software license.

Recommended language:

```text
Code is licensed under Apache-2.0. Emotional Infrastructure™ is a trademark of Brittany Wright.
```
