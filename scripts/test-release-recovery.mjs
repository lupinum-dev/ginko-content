import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const workflow = parse(readFileSync(resolve(root, ".github/workflows/publish.yml"), "utf8"));

const stepProgram = (jobName, stepName) => {
  const program = workflow.jobs?.[jobName]?.steps?.find((step) => step.name === stepName)?.run;
  assert.equal(typeof program, "string", `Missing ${jobName} step ${stepName}.`);
  return program;
};

const protectedRun = stepProgram("publish", "Publish or verify the certified tarball").trim();
const protectedMatch = /^node --input-type=module <<'NODE'\n([\s\S]+)\nNODE$/u.exec(protectedRun);
assert(protectedMatch, "The protected release program must remain extractable for fixtures.");
const protectedProgram = protectedMatch[1];
const fastProtectedProgram = protectedProgram
  .replace("attempt < 240", "attempt < 1")
  .replace(
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)",
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0)",
  )
  .replace(
    "const fail = message => { throw new Error(message) }",
    `const fixtureFetch = async (url, options) => {
      const fixture = JSON.parse(readFileSync(process.env.FETCH_FIXTURE, 'utf8'))
      if (String(url) !== fixture.url) throw new Error('Unexpected fetch URL: ' + url)
      if (options?.redirect !== 'error') throw new Error('Attestation fetch must reject redirects')
      if (!(options?.signal instanceof AbortSignal) || options.signal.aborted) throw new Error('Attestation fetch must have a bounded signal')
      return { ok: fixture.ok, status: fixture.status, json: async () => fixture.document }
    }
    const fail = message => { throw new Error(message) }`,
  )
  .replace("await fetch(url, {", "await fixtureFetch(url, {");
assert.notEqual(fastProtectedProgram, protectedProgram, "The polling fixture must run once.");
assert(!fastProtectedProgram.includes("await fetch(url"), "The fixture must intercept attestation fetches.");

const sourceSha = "a".repeat(40);
const currentMainSha = "b".repeat(40);
const releaseVersion = "1.2.3";
const packageName = "@lupinum/ginko-content";
const tarball = "lupinum-ginko-content-1.2.3.tgz";
const tarballBytes = Buffer.from("certified ginko content tarball");
const tarballSha1 = createHash("sha1").update(tarballBytes).digest("hex");
const tarballSha512 = createHash("sha512").update(tarballBytes).digest("hex");
const attestationUrl = `https://registry.npmjs.org/-/npm/v1/attestations/${packageName}@${releaseVersion}`;
const slsaBundle = { mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json", fixture: "source-a" };
const attestationDocument = {
  attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: slsaBundle }],
};
const provenanceBundleSha256 = createHash("sha256")
  .update(JSON.stringify(slsaBundle))
  .digest("hex");

const fakeNpmSource = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const fixture = JSON.parse(readFileSync(process.env.NPM_FIXTURE, "utf8"));
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("11.18.0\\n");
  process.exit(0);
}
if (args[0] === "view") {
  const key = args[1] + " " + args[2];
  if (!Object.hasOwn(fixture.views, key)) {
    process.stderr.write("Unexpected npm view: " + key + "\\n");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(fixture.views[key]));
  process.exit(0);
}
process.stderr.write("Unexpected npm command: " + args.join(" ") + "\\n");
process.exit(2);
`;

const runProtected = ({
  attestations,
  fetchedAttestations = attestationDocument,
  recordChange,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "ginko-content-protected-release-"));
  try {
    const releaseDir = join(directory, ".release");
    const binDir = join(directory, "bin");
    mkdirSync(releaseDir);
    mkdirSync(binDir);

    const manifest = { packageName, packageVersion: releaseVersion, commit: sourceSha, tarball };
    const record = {
      schemaVersion: 1,
      packageName,
      packageVersion: releaseVersion,
      sourceSha,
      tarball,
      tarballSha1,
      tarballSha512,
      registryState: "verified-existing",
      registryShasum: tarballSha1,
      provenanceBundleSha256,
    };
    recordChange?.(record);
    writeFileSync(join(releaseDir, "release-artifact.json"), JSON.stringify(manifest));
    writeFileSync(join(releaseDir, "registry-verification.json"), JSON.stringify(record));
    writeFileSync(join(releaseDir, tarball), tarballBytes);

    const spec = `${packageName}@${releaseVersion}`;
    const npmFixture = join(directory, "npm-fixture.json");
    const fetchFixture = join(directory, "fetch-fixture.json");
    writeFileSync(
      npmFixture,
      JSON.stringify({
        views: {
          [`${spec} version`]: releaseVersion,
          [`${spec} dist.shasum`]: tarballSha1,
          [`${spec} dist.attestations`]: attestations,
          [`${packageName} dist-tags.latest`]: releaseVersion,
        },
      }),
    );
    writeFileSync(
      fetchFixture,
      JSON.stringify({ document: fetchedAttestations, ok: true, status: 200, url: attestations?.url }),
    );
    const fakeNpm = join(binDir, "npm");
    writeFileSync(fakeNpm, fakeNpmSource);
    chmodSync(fakeNpm, 0o755);

    return spawnSync(process.execPath, ["--input-type=module", "--eval", fastProtectedProgram], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_SHA: currentMainSha,
        FETCH_FIXTURE: fetchFixture,
        NPM_FIXTURE: npmFixture,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        RELEASE_VERSION: releaseVersion,
      },
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
};

const provenance = {
  url: attestationUrl,
  provenance: { predicateType: "https://slsa.dev/provenance/v1" },
};
const completeRegistry = runProtected({ attestations: provenance });
assert.equal(completeRegistry.status, 0, completeRegistry.stderr);

for (const incomplete of [{}, { url: provenance.url }, { provenance: provenance.provenance }]) {
  const incompleteRegistry = runProtected({ attestations: incomplete });
  assert.notEqual(incompleteRegistry.status, 0, "Incomplete provenance metadata must fail.");
  assert.match(incompleteRegistry.stderr, /Registry provenance metadata is incomplete/u);
}

const unverifiedRecord = runProtected({
  attestations: provenance,
  recordChange: (record) => {
    record.provenanceBundleSha256 = null;
  },
});
assert.notEqual(unverifiedRecord.status, 0, "Existing bytes require a verification hash.");
assert.match(unverifiedRecord.stderr, /Registry verification record does not match/u);

const changedProvenanceUrl = runProtected({
  attestations: { ...provenance, url: "https://registry.npmjs.org/download/attestations/fixture" },
});
assert.notEqual(changedProvenanceUrl.status, 0, "A changed attestation path must fail.");
assert.match(changedProvenanceUrl.stderr, /Registry provenance URL is not trusted/u);

const changedProvenanceBundle = runProtected({
  attestations: provenance,
  fetchedAttestations: {
    attestations: [{
      predicateType: "https://slsa.dev/provenance/v1",
      bundle: { ...slsaBundle, fixture: "changed-after-approval" },
    }],
  },
});
assert.notEqual(changedProvenanceBundle.status, 0, "A changed provenance bundle must fail.");
assert.match(changedProvenanceBundle.stderr, /registry provenance changed after verification/u);

const multipleProvenanceBundles = runProtected({
  attestations: provenance,
  fetchedAttestations: {
    attestations: [
      { predicateType: "https://slsa.dev/provenance/v1", bundle: slsaBundle },
      { predicateType: "https://slsa.dev/provenance/v1", bundle: { fixture: "second" } },
    ],
  },
});
assert.notEqual(multipleProvenanceBundles.status, 0, "Multiple SLSA bundles must fail.");
assert.match(multipleProvenanceBundles.stderr, /exactly one SLSA provenance bundle/u);

const changedRegistry = runProtected({
  attestations: provenance,
  recordChange: (record) => {
    record.registryState = "absent";
    record.registryShasum = null;
    record.provenanceBundleSha256 = null;
  },
});
assert.notEqual(changedRegistry.status, 0, "A publish race must stop the protected job.");
assert.match(changedRegistry.stderr, /registry existence or bytes changed after verification/u);

const fakeAuthorizationGhSource = `#!/usr/bin/env node
const { readFileSync } = require("node:fs");
const fixture = JSON.parse(readFileSync(process.env.GH_FIXTURE, "utf8"));
const endpoint = process.argv[3] || "";
if (endpoint.endsWith("/commits/main")) {
  process.stdout.write(fixture.currentMain + "\\n");
  process.exit(0);
}
if (endpoint.includes("/actions/workflows/ci.yml/runs?")) {
  const headSha = new URL("https://fixture.invalid" + endpoint.slice(endpoint.indexOf("?"))).searchParams.get("head_sha");
  const runId = headSha === fixture.currentMain ? fixture.currentCi : headSha === fixture.source ? fixture.sourceCi : null;
  if (runId) process.stdout.write(String(runId) + "\\n");
  process.exit(0);
}
if (endpoint.includes("/compare/")) {
  process.stdout.write(JSON.stringify({
    merge_base_commit: { sha: fixture.source },
    status: fixture.sourceIsAncestor ? "ahead" : "diverged",
  }));
  process.exit(0);
}
if (endpoint.includes("/git/matching-refs/tags/")) {
  if (fixture.tag) process.stdout.write(fixture.tag.type + "\\t" + fixture.tag.sha + "\\n");
  process.exit(0);
}
const tagObject = endpoint.match(/\\/git\\/tags\\/([0-9a-f]+)$/);
if (tagObject && fixture.peeled?.[tagObject[1]]) {
  const target = fixture.peeled[tagObject[1]];
  process.stdout.write(target.type + "\\t" + target.sha + "\\n");
  process.exit(0);
}
process.stderr.write("Unexpected gh api endpoint: " + endpoint + "\\n");
process.exit(2);
`;

const runAuthorizationStep = (stepName, fixture, extraEnv = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "ginko-content-authorization-"));
  try {
    const binDir = join(directory, "bin");
    mkdirSync(binDir);
    const ghFixture = join(directory, "gh-fixture.json");
    const githubOutput = join(directory, "github-output.txt");
    writeFileSync(ghFixture, JSON.stringify(fixture));
    writeFileSync(githubOutput, "");
    const fakeGh = join(binDir, "gh");
    writeFileSync(fakeGh, fakeAuthorizationGhSource);
    chmodSync(fakeGh, 0o755);
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", stepProgram("verify", stepName)], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GH_FIXTURE: ghFixture,
        GH_TOKEN: "fixture",
        GITHUB_OUTPUT: githubOutput,
        GITHUB_REF: "refs/heads/main",
        GITHUB_REPOSITORY: "lupinum-dev/ginko-content",
        GITHUB_SHA: currentMainSha,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        RELEASE_SOURCE_SHA: sourceSha,
        RELEASE_VERSION: releaseVersion,
        ...extraEnv,
      },
    });
    return { output: readFileSync(githubOutput, "utf8"), result };
  } finally {
    rmSync(directory, { recursive: true });
  }
};

const authorizationFixture = {
  currentMain: currentMainSha,
  source: sourceSha,
  currentCi: 101,
  sourceCi: 202,
  sourceIsAncestor: true,
  tag: { type: "commit", sha: sourceSha },
};
assert.notEqual(sourceSha, currentMainSha, "Recovery fixture must use source A and current main B.");

const currentMainCheck = runAuthorizationStep("Require current main", authorizationFixture);
assert.equal(currentMainCheck.result.status, 0, currentMainCheck.result.stderr);
const staleDispatch = runAuthorizationStep("Require current main", {
  ...authorizationFixture,
  currentMain: "c".repeat(40),
});
assert.notEqual(staleDispatch.result.status, 0, "A stale dispatch SHA must fail.");

const currentCiCheck = runAuthorizationStep(
  "Require successful CI for current main",
  authorizationFixture,
);
assert.equal(currentCiCheck.result.status, 0, currentCiCheck.result.stderr);
const missingCurrentCi = runAuthorizationStep("Require successful CI for current main", {
  ...authorizationFixture,
  currentCi: null,
});
assert.notEqual(missingCurrentCi.result.status, 0, "Current main without push CI must fail.");

const safeSourceCheck = runAuthorizationStep("Require a safe source and release tag", authorizationFixture);
assert.equal(safeSourceCheck.result.status, 0, safeSourceCheck.result.stderr);
const unsafeSource = runAuthorizationStep("Require a safe source and release tag", {
  ...authorizationFixture,
  sourceIsAncestor: false,
});
assert.notEqual(unsafeSource.result.status, 0, "A source outside current main must fail.");
const conflictingAuthorizationTag = runAuthorizationStep(
  "Require a safe source and release tag",
  { ...authorizationFixture, tag: { type: "commit", sha: currentMainSha } },
);
assert.notEqual(
  conflictingAuthorizationTag.result.status,
  0,
  "An existing release tag outside the certified source must fail.",
);

const sourceCiCheck = runAuthorizationStep(
  "Find successful CI for the certified source",
  authorizationFixture,
);
assert.equal(sourceCiCheck.result.status, 0, sourceCiCheck.result.stderr);
assert.match(sourceCiCheck.output, /^run-id=202$/mu);
const missingSourceCi = runAuthorizationStep("Find successful CI for the certified source", {
  ...authorizationFixture,
  sourceCi: null,
});
assert.notEqual(missingSourceCi.result.status, 0, "Certified source without push CI must fail.");

const githubReleaseProgram = stepProgram(
  "github-release",
  "Create release from the published artifact",
);
const fakeGhSource = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const fixture = JSON.parse(readFileSync(process.env.GH_FIXTURE, "utf8"));
const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "api") {
  const endpoint = args.find(value => value.startsWith("repos/")) || "";
  const methodIndex = args.indexOf("--method");
  if (methodIndex !== -1 && args[methodIndex + 1] === "POST") {
    const shaField = args.find(value => value.startsWith("sha="));
    fixture.tag = fixture.tagAfterPost || { type: "commit", sha: shaField.slice(4) };
    writeFileSync(process.env.GH_FIXTURE, JSON.stringify(fixture));
    process.exit(fixture.postFails ? 1 : 0);
  }
  if (endpoint.includes("/releases/tags/")) {
    process.stdout.write("HTTP/2.0 " + fixture.releaseStatus + " Fixture\\n");
    process.exit(fixture.releaseStatus === 200 ? 0 : 1);
  }
  if (endpoint.includes("/git/matching-refs/tags/")) {
    if (fixture.tag) process.stdout.write(fixture.tag.type + "\\t" + fixture.tag.sha + "\\n");
    process.exit(0);
  }
  const tagObject = endpoint.match(/\\/git\\/tags\\/([0-9a-f]+)$/);
  if (tagObject && fixture.peeled[tagObject[1]]) {
    const target = fixture.peeled[tagObject[1]];
    process.stdout.write(target.type + "\\t" + target.sha + "\\n");
    process.exit(0);
  }
  process.stderr.write("Unexpected gh api endpoint: " + endpoint + "\\n");
  process.exit(2);
}
if (args[0] === "release" && ["upload", "edit", "create"].includes(args[1])) process.exit(0);
process.stderr.write("Unexpected gh command: " + args.join(" ") + "\\n");
process.exit(2);
`;

const runGithubRelease = ({
  version,
  tag,
  peeled = {},
  releaseExists,
  releaseStatus = releaseExists ? 200 : 404,
  postFails = false,
  tagAfterPost,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "ginko-content-github-release-"));
  try {
    const releaseDir = join(directory, ".release");
    const binDir = join(directory, "bin");
    mkdirSync(releaseDir);
    mkdirSync(binDir);
    writeFileSync(
      join(releaseDir, "release-artifact.json"),
      JSON.stringify({ commit: sourceSha, tarball }),
    );
    writeFileSync(
      join(releaseDir, "registry-verification.json"),
      JSON.stringify({ sourceSha }),
    );
    writeFileSync(join(releaseDir, "release-notes.md"), "Release notes\n");
    writeFileSync(join(releaseDir, tarball), tarballBytes);

    const ghFixture = join(directory, "gh-fixture.json");
    const ghLog = join(directory, "gh.log");
    writeFileSync(
      ghFixture,
      JSON.stringify({ tag, peeled, postFails, releaseStatus, tagAfterPost }),
    );
    writeFileSync(ghLog, "");
    const fakeGh = join(binDir, "gh");
    writeFileSync(fakeGh, fakeGhSource);
    chmodSync(fakeGh, 0o755);

    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", githubReleaseProgram], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GH_FIXTURE: ghFixture,
        GH_LOG: ghLog,
        GH_TOKEN: "fixture",
        GITHUB_REPOSITORY: "lupinum-dev/ginko-content",
        GITHUB_SHA: currentMainSha,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        RELEASE_VERSION: version,
      },
    });
    const calls = readFileSync(ghLog, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { calls, result };
  } finally {
    rmSync(directory, { recursive: true });
  }
};

const stableRepair = runGithubRelease({
  version: releaseVersion,
  tag: { type: "commit", sha: sourceSha },
  releaseExists: true,
});
assert.equal(stableRepair.result.status, 0, stableRepair.result.stderr);
const stableEdit = stableRepair.calls.find((args) => args[0] === "release" && args[1] === "edit");
assert(stableEdit?.includes("--prerelease=false"), "Stable repair must clear prerelease state.");

const firstTagSha = "b".repeat(40);
const secondTagSha = "c".repeat(40);
const prereleaseRepair = runGithubRelease({
  version: "1.2.3-beta.1",
  tag: { type: "tag", sha: firstTagSha },
  peeled: {
    [firstTagSha]: { type: "tag", sha: secondTagSha },
    [secondTagSha]: { type: "commit", sha: sourceSha },
  },
  releaseExists: true,
});
assert.equal(prereleaseRepair.result.status, 0, prereleaseRepair.result.stderr);
for (const tagSha of [firstTagSha, secondTagSha]) {
  assert(
    prereleaseRepair.calls.some(
      (args) => args[0] === "api" && args[1].endsWith(`/git/tags/${tagSha}`),
    ),
    "Annotated tags must be peeled recursively to their commit.",
  );
}
const prereleaseEdit = prereleaseRepair.calls.find(
  (args) => args[0] === "release" && args[1] === "edit",
);
assert(prereleaseEdit?.includes("--prerelease"), "Prerelease repair must set prerelease state.");

const conflictingTag = runGithubRelease({
  version: releaseVersion,
  tag: { type: "commit", sha: "d".repeat(40) },
  releaseExists: false,
});
assert.notEqual(conflictingTag.result.status, 0, "A conflicting tag must stop release creation.");
assert(
  !conflictingTag.calls.some(
    (args) => args[0] === "release" && ["create", "edit", "upload"].includes(args[1]),
  ),
  "A conflicting tag must never be moved or reused.",
);

const freshRelease = runGithubRelease({
  version: releaseVersion,
  tag: null,
  releaseExists: false,
});
assert.equal(freshRelease.result.status, 0, freshRelease.result.stderr);
const createCall = freshRelease.calls.find((args) => args[0] === "release" && args[1] === "create");
assert(createCall?.includes("--verify-tag"), "Release creation must verify the source-bound tag.");
assert(!createCall?.includes("--prerelease"));
assert(
  freshRelease.calls.some(
    (args) => args[0] === "api" && args.includes("POST") && args.includes(`sha=${sourceSha}`),
  ),
  "A missing tag must be created atomically at the certified source.",
);

const conflictingTagRace = runGithubRelease({
  version: releaseVersion,
  tag: null,
  releaseExists: false,
  postFails: true,
  tagAfterPost: { type: "commit", sha: "e".repeat(40) },
});
assert.notEqual(
  conflictingTagRace.result.status,
  0,
  "A concurrent conflicting tag creator must stop release creation.",
);
assert(
  !conflictingTagRace.calls.some(
    (args) => args[0] === "release" && args[1] === "create",
  ),
  "A race-lost conflicting tag must not create a GitHub Release.",
);

const orphanedRelease = runGithubRelease({
  version: releaseVersion,
  tag: null,
  releaseExists: true,
});
assert.notEqual(orphanedRelease.result.status, 0, "Release repair requires its existing tag.");

const releaseApiFailure = runGithubRelease({
  version: releaseVersion,
  tag: null,
  releaseExists: false,
  releaseStatus: 500,
});
assert.notEqual(releaseApiFailure.result.status, 0, "Release API errors must fail closed.");
assert.match(releaseApiFailure.result.stderr, /Release lookup failed with HTTP status 500/u);
assert(
  !releaseApiFailure.calls.some(
    (args) => args[0] === "api" && args.includes("POST"),
  ),
  "A Release lookup error must abort before tag mutation.",
);

process.stdout.write("Protected release recovery fixtures passed.\n");
