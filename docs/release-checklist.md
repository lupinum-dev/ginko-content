# Release Checklist

Run this before publishing `@lupinum/ginko-content` or changing the public
content API.

- [ ] `pnpm lint`
- [ ] `pnpm build:packages`
- [ ] `pnpm test`
- [ ] `pnpm test:e2e`
- [ ] `pnpm typecheck`
- [ ] `pnpm docs:build`
- [ ] `pnpm examples:build`
- [ ] `pnpm pack:check`
- [ ] `pnpm test -- test/contracts/package-exports-contracts.test.ts`
- [ ] `pnpm test -- test/contracts/provider-contracts.test.ts`
- [ ] `pnpm test -- test/contracts/query-contracts.test.ts test/contracts/query-plan-contracts.test.ts`
- [ ] `GINKO_CONTENT_ROOT=/Users/matthias/Git/0_libs/WORK/ginko-content pnpm --dir /Users/matthias/Git/0_libs/WORK/ginko-cms run check:cms-contract-vendor`
- [ ] `pnpm --dir /Users/matthias/Git/0_libs/WORK/ginko-cms run test:public-content -- --reporter=dot`
- [ ] `pnpm --dir /Users/matthias/Git/0_libs/WORK/ginko-cms run package:e2e`

Do not publish if docs or examples teach removed public APIs, if a documented
public operator is rejected at runtime, or if provider capability tests fail.
