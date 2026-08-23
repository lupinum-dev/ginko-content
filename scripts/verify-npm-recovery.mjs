import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REGISTRY_URL = "https://registry.npmjs.org";
export const REPOSITORY_URL = "https://github.com/lupinum-dev/ginko-content";
export const WORKFLOW_PATH = ".github/workflows/publish.yml";
export const MAIN_REF = "refs/heads/main";
export const WORKFLOW_IDENTITY = `${REPOSITORY_URL}/${WORKFLOW_PATH}@${MAIN_REF}`;
export const PROVENANCE_TYPE = "https://slsa.dev/provenance/v1";

const fail = (message) => {
  throw new Error(message);
};

const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");

const exactPattern = (value) => `^${value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`;

const loadSigstoreVerifier = () => {
  if (!process.env.SIGSTORE_PREFIX) {
    fail("SIGSTORE_PREFIX must point to the isolated Sigstore installation.");
  }
  const requireSigstore = createRequire(join(resolve(process.env.SIGSTORE_PREFIX), "package.json"));
  const { verify } = requireSigstore("sigstore");
  const version = requireSigstore("sigstore/package.json").version;
  if (version !== "5.0.0") fail(`Expected sigstore 5.0.0, received ${version}.`);
  return verify;
};

export const sigstorePolicy = (sourceSha) => ({
  certificateIssuer: "https://token.actions.githubusercontent.com",
  certificateIdentityURI: exactPattern(WORKFLOW_IDENTITY),
  certificateOIDs: {
    // Sigstore 5 accepts string OID values as raw bytes. GitHub's original
    // Fulcio extensions use that encoding; the newer generic extensions are
    // DER UTF8Strings and cannot be expressed through this public option.
    "1.3.6.1.4.1.57264.1.3": sourceSha,
    "1.3.6.1.4.1.57264.1.5": "lupinum-dev/ginko-content",
    "1.3.6.1.4.1.57264.1.6": MAIN_REF,
  },
});

const packagePurl = ({ packageName, packageVersion }) => {
  const encodedName = packageName.startsWith("@") ? `%40${packageName.slice(1)}` : packageName;
  return `pkg:npm/${encodedName}@${packageVersion}`;
};

export const validateProvenanceStatement = (statement, manifest, tarballSha512) => {
  const subjects = statement.subject ?? [];
  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
  const dependencies = statement.predicate?.buildDefinition?.resolvedDependencies ?? [];
  const expectedDependency = `git+${REPOSITORY_URL}@${MAIN_REF}`;

  if (
    statement._type !== "https://in-toto.io/Statement/v1" ||
    statement.predicateType !== PROVENANCE_TYPE ||
    subjects.length !== 1 ||
    subjects[0]?.name !== packagePurl(manifest) ||
    subjects[0]?.digest?.sha512 !== tarballSha512 ||
    Object.keys(subjects[0]?.digest ?? {}).length !== 1 ||
    workflow?.repository !== REPOSITORY_URL ||
    workflow?.path !== WORKFLOW_PATH ||
    workflow?.ref !== MAIN_REF ||
    statement.predicate?.runDetails?.builder?.id !==
      "https://github.com/actions/runner/github-hosted" ||
    dependencies.length !== 1 ||
    dependencies[0]?.uri !== expectedDependency ||
    dependencies[0]?.digest?.gitCommit !== manifest.commit ||
    Object.keys(dependencies[0]?.digest ?? {}).length !== 1
  ) {
    fail("npm provenance does not match the certified workflow, source, and tarball.");
  }
};

const decodeStatement = (bundle) => {
  if (
    bundle?.dsseEnvelope?.payloadType !== "application/vnd.in-toto+json" ||
    typeof bundle.dsseEnvelope.payload !== "string"
  ) {
    fail("npm provenance has no supported DSSE statement.");
  }

  try {
    return JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));
  } catch {
    fail("npm provenance contains an invalid DSSE statement.");
  }
};

const uniqueProvenanceBundle = (attestationDocument, packageSpec) => {
  const attestations = (attestationDocument?.attestations ?? []).filter(
    (attestation) => attestation.predicateType === PROVENANCE_TYPE,
  );
  if (attestations.length !== 1 || !attestations[0]?.bundle) {
    fail(`${packageSpec} has no unique npm provenance.`);
  }
  return attestations[0].bundle;
};

const sourceFromStatement = (statement) => {
  const dependencies = statement.predicate?.buildDefinition?.resolvedDependencies ?? [];
  const sourceSha = dependencies.length === 1
    ? dependencies[0]?.digest?.gitCommit
    : undefined;
  if (!/^[0-9a-f]{40}$/u.test(sourceSha ?? "")) {
    fail("npm provenance does not contain one exact source commit.");
  }
  return sourceSha;
};

export const integritySha512 = (integrity) => {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(integrity ?? "");
  if (!match) fail("npm returned no exact SHA-512 integrity.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length !== 64) fail("npm returned an invalid SHA-512 integrity.");
  return bytes.toString("hex");
};

const verifyProvenance = async ({
  attestationDocument,
  manifest,
  packageSpec,
  tarballSha512,
  verifyBundle,
}) => {
  const bundle = uniqueProvenanceBundle(attestationDocument, packageSpec);
  const statement = decodeStatement(bundle);
  const sourceSha = sourceFromStatement(statement);
  if (manifest.commit && manifest.commit !== sourceSha) {
    fail("npm provenance targets a different source commit.");
  }
  const exactManifest = { ...manifest, commit: sourceSha };
  await (verifyBundle ?? loadSigstoreVerifier())(bundle, sigstorePolicy(sourceSha));
  validateProvenanceStatement(statement, exactManifest, tarballSha512);
  return { bundle, sourceSha };
};

export const createRegistryVerificationRecord = async ({
  manifest,
  tarballBytes,
  registryShasum,
  attestationDocument,
  verifyBundle,
}) => {
  const tarballSha1 = digest("sha1", tarballBytes);
  const tarballSha512 = digest("sha512", tarballBytes);
  let provenanceBundleSha256 = null;

  if (registryShasum !== null) {
    if (registryShasum !== tarballSha1) {
      fail(`${manifest.packageName}@${manifest.packageVersion} exists with different bytes.`);
    }

    const { bundle, sourceSha } = await verifyProvenance({
      attestationDocument,
      manifest,
      packageSpec: `${manifest.packageName}@${manifest.packageVersion}`,
      tarballSha512,
      verifyBundle,
    });
    if (sourceSha !== manifest.commit) fail("The registry source differs from the artifact source.");
    provenanceBundleSha256 = digest("sha256", Buffer.from(JSON.stringify(bundle)));
  }

  return {
    schemaVersion: 1,
    packageName: manifest.packageName,
    packageVersion: manifest.packageVersion,
    sourceSha: manifest.commit,
    tarball: manifest.tarball,
    tarballSha1,
    tarballSha512,
    registryState: registryShasum === null ? "absent" : "verified-existing",
    registryShasum,
    provenanceBundleSha256,
  };
};

const npmView = (spec, field) => {
  const result = spawnSync("npm", ["view", spec, field, "--json", "--registry", REGISTRY_URL], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return JSON.parse(result.stdout.trim() || "null");
  if (/E404|404 Not Found/u.test(result.stderr)) return null;
  fail(`npm view failed for ${spec} ${field}: ${result.stderr.trim()}`);
};

export const fetchAttestations = async (metadata, fetchImpl = fetch) => {
  if (!metadata?.url) fail("The existing npm version has no provenance URL.");
  const url = new URL(metadata.url);
  if (
    url.origin !== REGISTRY_URL ||
    !url.pathname.startsWith("/-/npm/v1/attestations/") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    fail("The npm provenance URL is outside the registry attestation API.");
  }
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`npm provenance lookup failed: HTTP ${response.status}.`);
  return response.json();
};

export const resolveReleaseSource = async ({
  packageVersion,
  currentMainSha,
  view = npmView,
  fetchDocument = fetchAttestations,
  verifyBundle,
}) => {
  if (!/^[0-9a-f]{40}$/u.test(currentMainSha)) fail("Current main has no exact source commit.");
  const packageName = "@lupinum/ginko-content";
  const spec = `${packageName}@${packageVersion}`;
  const registryVersion = view(spec, "version");
  if (registryVersion === null) {
    return { registryState: "absent", sourceSha: currentMainSha };
  }
  if (registryVersion !== packageVersion) fail(`npm returned an unexpected version for ${spec}.`);

  const registryShasum = view(spec, "dist.shasum");
  if (!/^[0-9a-f]{40}$/u.test(registryShasum ?? "")) {
    fail(`${spec} exists without an exact registry shasum.`);
  }
  const tarballSha512 = integritySha512(view(spec, "dist.integrity"));
  const metadata = view(spec, "dist.attestations");
  const attestationDocument = await fetchDocument(metadata);
  const { sourceSha } = await verifyProvenance({
    attestationDocument,
    manifest: { packageName, packageVersion },
    packageSpec: spec,
    tarballSha512,
    verifyBundle,
  });
  return { registryState: "verified-existing", sourceSha };
};

const verifyArtifact = async () => {
  const releaseDir = resolve(process.env.RELEASE_DIR ?? ".release");
  const manifest = JSON.parse(readFileSync(resolve(releaseDir, "release-artifact.json"), "utf8"));
  if (
    manifest.packageName !== "@lupinum/ginko-content" ||
    manifest.packageVersion !== process.env.RELEASE_VERSION ||
    !/^[0-9a-f]{40}$/u.test(manifest.commit) ||
    !/^[a-z0-9._-]+\.tgz$/u.test(manifest.tarball)
  ) {
    fail("The certified release coordinates are invalid.");
  }

  const tarballBytes = readFileSync(resolve(releaseDir, manifest.tarball));
  const spec = `${manifest.packageName}@${manifest.packageVersion}`;
  const registryVersion = npmView(spec, "version");
  if (registryVersion !== null && registryVersion !== manifest.packageVersion) {
    fail(`npm returned an unexpected version for ${spec}.`);
  }
  const registryShasum = registryVersion === null ? null : npmView(spec, "dist.shasum");
  if (registryVersion !== null && !/^[0-9a-f]{40}$/u.test(registryShasum)) {
    fail(`${spec} exists without an exact registry shasum.`);
  }
  const metadata = registryShasum === null ? null : npmView(spec, "dist.attestations");
  const attestationDocument = registryShasum === null ? null : await fetchAttestations(metadata);
  const record = await createRegistryVerificationRecord({
    manifest,
    tarballBytes,
    registryShasum,
    attestationDocument,
  });

  writeFileSync(
    resolve(releaseDir, "registry-verification.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    { flag: "wx" },
  );
};

const main = async () => {
  if (process.argv.includes("--resolve-source")) {
    const resolved = await resolveReleaseSource({
      packageVersion: process.env.RELEASE_VERSION,
      currentMainSha: process.env.CURRENT_MAIN_SHA,
    });
    process.stdout.write(`source-sha=${resolved.sourceSha}\nregistry-state=${resolved.registryState}\n`);
    return;
  }
  await verifyArtifact();
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
