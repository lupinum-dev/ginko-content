# Release Checklist

Run this before publishing `@lupinum/ginko-content` or changing the public
content API.

- [ ] Confirm the version is unpublished with `npm view @lupinum/ginko-content@$VERSION version --registry=https://registry.npmjs.org/`
- [ ] `pnpm lint`
- [ ] `pnpm build:packages`
- [ ] `pnpm test`
- [ ] `pnpm test:e2e`
- [ ] `pnpm typecheck`
- [ ] `pnpm docs:build`
- [ ] `pnpm examples:build`
- [ ] `pnpm pack:check`
- [ ] `pnpm run release:verify`
- [ ] Confirm `release:verify` ran packed consumer, browser e2e, search matrix, static sitemap checks, production audit, and release packing.
- [ ] Confirm the packed consumer check covered the installed package's public subpaths, declarations, fresh app build/start, sitemap XML, search API/index behavior, and agent markdown outputs.
- [ ] If a separate CMS/studio repository exists, run its current package-consumer checks against the packed tarball; keep those commands in that repository, not here.
- [ ] Inspect `.pack/lupinum-ginko-content-$VERSION.tgz` manifest, file list, and checksum.
- [ ] Commit the release prep before publishing; do not commit `.pack/` artifacts.
- [ ] Push `main` and the explicit annotated tag with `git push origin v$VERSION`.
- [ ] Publish manually with `npm publish .pack/lupinum-ginko-content-$VERSION.tgz --access public --registry=https://registry.npmjs.org/`.
- [ ] Confirm npm access/status and allow for brief `npm view` propagation delay.
- [ ] Create the GitHub release from the same tag and tarball.
- [ ] Run a clean install smoke test outside the repository.

Do not publish if docs or examples teach removed public APIs, if a documented
public operator is rejected at runtime, or if provider capability tests fail.
