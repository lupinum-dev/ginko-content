import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const publishSource = readFileSync(resolve(root, ".github/workflows/publish.yml"), "utf8");
const ciSource = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const recoverySource = readFileSync(resolve(root, "scripts/verify-npm-recovery.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const lockSource = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
const sigstoreManifest = JSON.parse(
  readFileSync(resolve(root, "scripts/sigstore-verifier/package.json"), "utf8"),
);
const sigstoreLock = JSON.parse(
  readFileSync(resolve(root, "scripts/sigstore-verifier/package-lock.json"), "utf8"),
);
const publish = parse(publishSource);
const ci = parse(ciSource);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const publishJob = publish.jobs?.publish;
assert(publishJob?.environment === "npm", "Publishing must use the protected npm environment.");
assert(
  publishJob?.permissions?.["id-token"] === "write",
  "Publishing must use npm trusted publishing.",
);

const publishJobSource =
  /^ {2}publish:\n([\s\S]*?)(?=^ {2}[a-z][a-z-]*:\n)/m.exec(publishSource)?.[1] ?? "";
const verifyJobSource =
  /^ {2}verify:\n([\s\S]*?)(?=^ {2}[a-z][a-z-]*:\n)/m.exec(publishSource)?.[1] ?? "";
for (const forbidden of [
  "actions/checkout@",
  "npm install",
  "pnpm install",
  "node scripts/",
  "sigstore",
  "signedAccessSignatureUrl",
  "dsseEnvelope",
]) {
  assert(
    !publishJobSource.includes(forbidden),
    `The privileged job must not contain ${forbidden}.`,
  );
}
assert(
  (publishJobSource.match(/fetch\(/g) ?? []).length === 1 &&
    publishJobSource.includes("await fetch(url, {") &&
    publishJobSource.includes("url.origin !== 'https://registry.npmjs.org'") &&
    publishJobSource.includes("url.pathname.startsWith('/-/npm/v1/attestations/')") &&
    publishJobSource.includes("url.username || url.password || url.search || url.hash") &&
    publishJobSource.includes("redirect: 'error'") &&
    publishJobSource.includes("signal: AbortSignal.timeout(10_000)"),
  "The privileged job may only fetch the validated npm attestation URL.",
);
for (const required of [
  "registry-verification.json",
  "Object.keys(record).sort()",
  "record.sourceSha !== manifest.commit",
  "record.tarballSha512 !== sha512",
  "existing !== record.registryShasum",
  "bundleSha256 !== record.provenanceBundleSha256",
  "attestations.length !== 1",
  "registry existence or bytes changed after verification",
]) {
  assert(
    publishJobSource.includes(required),
    `Protected record enforcement is missing ${required}.`,
  );
}

assert(
  verifyJobSource.includes("scripts/sigstore-verifier/package.json") &&
    verifyJobSource.includes("scripts/sigstore-verifier/package-lock.json") &&
    verifyJobSource.includes('npm ci --prefix "$SIGSTORE_PREFIX"') &&
    verifyJobSource.includes("--ignore-scripts --no-audit --no-fund") &&
    verifyJobSource.includes("node scripts/verify-npm-recovery.mjs"),
  "The unprivileged verifier must install Sigstore from its complete npm lockfile.",
);
for (const forbidden of ["npm install", "npm view sigstore", "--package-lock=false"]) {
  assert(!verifyJobSource.includes(forbidden), `The verifier must not use unlocked ${forbidden}.`);
}
assert(
  packageJson.devDependencies?.sigstore === undefined,
  "The isolated verifier must not narrow the repository's Node support.",
);
assert(!lockSource.includes("sigstore@5.0.0"), "Sigstore must not enter the workspace lockfile.");
assert(
  sigstoreManifest.private === true && sigstoreManifest.dependencies?.sigstore === "5.0.0",
  "The isolated verifier manifest must pin Sigstore 5.0.0.",
);
assert(
  sigstoreLock.lockfileVersion === 3 &&
    sigstoreLock.packages?.[""]?.dependencies?.sigstore === "5.0.0" &&
    sigstoreLock.packages?.["node_modules/sigstore"]?.version === "5.0.0",
  "The isolated verifier lockfile must pin Sigstore 5.0.0.",
);
for (const [path, dependency] of Object.entries(sigstoreLock.packages ?? {})) {
  if (!path) continue;
  assert(
    typeof dependency.resolved === "string" &&
      dependency.resolved.startsWith("https://registry.npmjs.org/") &&
      dependency.integrity?.startsWith("sha512-"),
    `The isolated verifier dependency ${path} must have registry and integrity pins.`,
  );
}
for (const required of [
  'version !== "5.0.0"',
  "verifyBundle ?? loadSigstoreVerifier()",
  "certificateIdentityURI",
  '"1.3.6.1.4.1.57264.1.3": sourceSha',
  "subjects[0]?.digest?.sha512 !== tarballSha512",
  "resolveReleaseSource",
  "dist.integrity",
  "url.username",
  "url.password",
  "url.search",
  "url.hash",
  'redirect: "error"',
  "signal: AbortSignal.timeout(10_000)",
]) {
  assert(recoverySource.includes(required), `Cryptographic recovery is missing ${required}.`);
}

for (const required of [
  'commits/main" --jq .sha',
  "head_sha=$GITHUB_SHA&event=push",
  "node scripts/verify-npm-recovery.mjs --resolve-source",
  "compare/$RELEASE_SOURCE_SHA...$GITHUB_SHA",
  "head_sha=$RELEASE_SOURCE_SHA&event=push",
  "m.commit!==process.env.RELEASE_SOURCE_SHA",
  "run-id: ${{ steps.ci.outputs.run-id }}",
  "contents/CHANGELOG.md?ref=$RELEASE_SOURCE_SHA",
]) {
  assert(verifyJobSource.includes(required), `Source-bound authorization is missing ${required}.`);
}

const githubReleaseJobSource =
  /^ {2}github-release:\n([\s\S]*)$/m.exec(publishSource)?.[1] ?? "";
for (const required of [
  "registry-verification.json",
  'test "$MANIFEST_SOURCE" = "$RECORD_SOURCE"',
  'test "$tag_sha" = "$MANIFEST_SOURCE"',
  '-f "sha=$MANIFEST_SOURCE"',
  "--verify-tag",
  "/releases/tags/v$RELEASE_VERSION",
  "--include --silent",
  '200) release_exists=true',
  '404) release_exists=false',
]) {
  assert(githubReleaseJobSource.includes(required), `Source-bound Release repair is missing ${required}.`);
}
assert(
  !githubReleaseJobSource.includes("gh release view"),
  "Release existence must use explicit GitHub API HTTP status handling.",
);

const verifiedUploads =
  publish.jobs?.verify?.steps?.filter(
    (step) =>
      /^actions\/upload-artifact@[0-9a-f]{40}$/u.test(step.uses ?? "") &&
      step.with?.name === "verified-ginko-content-release",
  ) ?? [];
assert(
  verifiedUploads.length === 1 && verifiedUploads[0].with?.["retention-days"] === 14,
  "The verified candidate must be retained for 14 days.",
);

const candidateUploads =
  ci.jobs?.["release-artifact"]?.steps?.filter(
    (step) =>
      /^actions\/upload-artifact@[0-9a-f]{40}$/u.test(step.uses ?? "") &&
      step.with?.name === "ginko-content-release",
  ) ?? [];
assert(
  candidateUploads.length === 1 && candidateUploads[0].with?.["retention-days"] === 14,
  "The CI candidate must be retained for 14 days.",
);

process.stdout.write("Release workflow policy verified.\n");
