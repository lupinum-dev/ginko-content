# Release Checklist

Run this before publishing `@lupinum/ginko-content` or changing the public
content API.

- [ ] Confirm the version is unpublished with `npm view @lupinum/ginko-content@$VERSION version --registry=https://registry.npmjs.org/`
- [ ] Optionally run `pnpm verify` once as a local pre-check; do not repeat its component commands independently.
- [ ] Commit all release metadata before the authoritative CI gate.
- [ ] Push `main` and record the exact release commit SHA.
- [ ] Confirm the CI workflow is green for that SHA on Node 24 and the focused Node 22 minimum-runtime job.
- [ ] Confirm the release job ran `verify` once, browser e2e, real static generation, production audit, exact release packing, and pnpm/npm consumers.
- [ ] Confirm the pnpm consumer covered public subpaths, declarations, fresh app build/start, sitemap XML, search API/index behavior, and agent markdown outputs.
- [ ] Confirm the npm consumer prepared, typechecked, and built the same tarball.
- [ ] If a separate CMS/studio repository exists, run its current package-consumer checks against the packed tarball; keep those commands in that repository, not here.
- [ ] Download the CI artifact and verify `release-artifact.json` names the release SHA and tarball checksum, with `worktreeDirty: false` and `releaseEligible: true`.
- [ ] Inspect `.pack/lupinum-ginko-content-$VERSION.tgz` manifest, file list, and checksum.
- [ ] Create the annotated tag at the exact green SHA and push it with `git push origin v$VERSION`.
- [ ] Publish manually with `npm publish .pack/lupinum-ginko-content-$VERSION.tgz --access public --registry=https://registry.npmjs.org/`.
- [ ] Confirm npm access/status and allow for brief `npm view` propagation delay.
- [ ] Create the GitHub release from the same tag and tarball.
- [ ] Run a clean install smoke test outside the repository.

Do not publish if docs or examples teach removed public APIs, if a documented
public operator is rejected at runtime, or if provider capability tests fail.
