# EIS SDK v0.2.0 Release Checklist

**Package:** `@emotional-infrastructure/sdk`  
**Release:** v0.2.0  
**Owner:** Brittany Wright  
**Status:** Release candidate until source verification passes

## 1. Repository setup

- [ ] Create repository: `github.com/emotional-infrastructure/sdk`
- [ ] Add source files under `src/`
- [ ] Add `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`
- [ ] Add `.gitignore`
- [ ] Add `.github/workflows/ci.yml`
- [ ] Confirm default branch is `main`
- [ ] Enable branch protection after first successful CI run

## 2. Package verification

Run locally from a clean checkout:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

Pass criteria:

- [ ] No TypeScript errors
- [ ] No lint errors
- [ ] Tests pass
- [ ] Coverage report generates
- [ ] Build creates `dist/`
- [ ] Type declarations generate under `dist/`
- [ ] `npm pack --dry-run` includes only intended files

## 3. Documentation verification

- [ ] README uses consistent release date
- [ ] README does not claim zero dependencies; it says `uuid` is the only runtime dependency
- [ ] README clearly defines production boundaries
- [ ] README includes installation, quick start, core modules, and architecture
- [ ] SECURITY.md defines signing/encryption limitations
- [ ] CHANGELOG.md includes v0.2.0 notes
- [ ] CONTRIBUTING.md includes development commands

## 4. npm readiness

- [ ] Confirm npm account access
- [ ] Confirm package scope access for `@emotional-infrastructure`
- [ ] Confirm package name availability
- [ ] Confirm license is Apache-2.0
- [ ] Confirm package exports work for ESM and CJS
- [ ] Confirm `types` path resolves

Publish command:

```bash
npm publish --access public
```

## 5. Post-publication validation

From a new temporary directory:

```bash
npm init -y
npm install @emotional-infrastructure/sdk
```

Then test imports:

```typescript
import { ConsentTokenID, AuditLogger, TrustRepair } from '@emotional-infrastructure/sdk';
```

- [ ] Import works in ESM
- [ ] Import works in CJS if supported
- [ ] Type declarations resolve
- [ ] Quick-start example runs

## 6. Public announcement sequence

- [ ] Publish GitHub repository
- [ ] Publish npm package
- [ ] Add release tag: `v0.2.0`
- [ ] Publish GitHub release notes
- [ ] Post LinkedIn announcement
- [ ] Add SDK link to Emotional Infrastructure™ portfolio or website
- [ ] Prepare runtime API demo as next milestone
