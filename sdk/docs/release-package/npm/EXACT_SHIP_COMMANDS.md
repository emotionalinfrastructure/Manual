# Exact Ship Commands

## Local verification

```bash
git clone https://github.com/emotional-infrastructure/sdk.git
cd sdk
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

## First commit

```bash
git init
git add .
git commit -m "Initial EIS SDK v0.2.0 release candidate"
git branch -M main
git remote add origin https://github.com/emotional-infrastructure/sdk.git
git push -u origin main
```

## Tag release

```bash
git tag v0.2.0
git push origin v0.2.0
```

## npm publish

```bash
npm login
npm publish --access public
```

## Post-publish smoke test

```bash
mkdir eis-sdk-smoke-test
cd eis-sdk-smoke-test
npm init -y
npm install @emotional-infrastructure/sdk
```

Create `test.mjs`:

```javascript
import { ConsentTokenID } from '@emotional-infrastructure/sdk';

const token = ConsentTokenID.create({
  userId: 'smoke-test-user',
  purpose: 'verification',
  scope: 'test',
});

console.log(token.ctid);
```

Run:

```bash
node test.mjs
```
