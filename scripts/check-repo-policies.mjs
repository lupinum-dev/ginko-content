import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { parse } from 'yaml'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignoredDirs = new Set([
  '.benchmarks',
  '.cache',
  '.data',
  '.fallow',
  '.git',
  '.nuxt',
  '.output',
  '.pack',
  '.temp',
  '.tmp',
  'coverage',
  'dist',
  'node_modules',
  'reports',
])
const scannedExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.mts',
  '.sh',
  '.ts',
  '.vue',
  '.yaml',
  '.yml',
])
const privateConsumerPattern = /(?:^|[^\w-])i18n-cms(?:[^\w-]|$)/m
const personalPathPattern = /\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s]+[\\/]/
const absoluteFileDependencyPattern = /\b(?:file|link):(?:\/|[A-Za-z]:[\\/])/
const cmsRuntimeCouplingPattern = /@lupinum\/ginko-cms/
const cmsNeutralRuntimeRoots = [
  'packages/content/src/core',
  'packages/content/src/features',
  'packages/content/src/integrations',
  'packages/content/src/module.ts',
  'packages/content/src/module',
  'packages/content/src/parsers',
  'packages/content/src/public',
  'packages/content/src/runtime',
  'packages/content/src/storage',
]
const trackedIgnoredArtifactPathspecs = [
  ':(glob)**/.pack/**',
  ':(glob)**/dist/**',
  ':(glob)**/.nuxt/**',
  ':(glob)**/.output/**',
  ':(glob)**/*.tgz',
]

const repositoryFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: repoRoot, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
const trackedRepositoryFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '-z'],
  { cwd: repoRoot, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)

function collectFiles(rootPath) {
  const normalizedRoot = rootPath.replaceAll('\\', '/').replace(/^\.\//u, '')
  return repositoryFiles
    .filter((filePath) => normalizedRoot === '.'
      || filePath === normalizedRoot
      || filePath.startsWith(`${normalizedRoot}/`))
    .filter((filePath) => !filePath.split('/').some(segment => ignoredDirs.has(segment)))
    .filter(filePath => scannedExtensions.has(extname(filePath)))
    .map(filePath => resolve(repoRoot, filePath))
    .filter(filePath => existsSync(filePath) && statSync(filePath).isFile())
}

const violations = []
const packageManifest = JSON.parse(readFileSync(join(repoRoot, 'packages/content/package.json'), 'utf8'))
const rootManifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const workspacePolicy = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
const ciWorkflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
const workspaceSettings = parse(workspacePolicy)
const ci = parse(ciWorkflow)
const renovate = JSON.parse(readFileSync(join(repoRoot, 'renovate.json'), 'utf8'))
if (!/^pnpm@(?:1[1-9]|[2-9]\d)\./u.test(rootManifest.packageManager ?? '')) {
  violations.push('package.json: pnpm 11 or newer is required for strict dependency quarantine')
}
for (const [name, expected] of Object.entries({
  minimumReleaseAge: 1440,
  minimumReleaseAgeStrict: true,
  minimumReleaseAgeIgnoreMissingTime: false,
})) {
  if (workspaceSettings?.[name] !== expected) {
    violations.push(`pnpm-workspace.yaml: ${name} must equal ${expected}`)
  }
}
const expectedAllowBuilds = {
  '@parcel/watcher': false,
  esbuild: true,
  'unrs-resolver': false,
  'vue-demi': true,
}
if (!isDeepStrictEqual(workspaceSettings?.allowBuilds, expectedAllowBuilds)) {
  violations.push('pnpm-workspace.yaml: allowBuilds must match the approved build-permission policy')
}
const actionVerificationSteps = Object.values(ci?.jobs ?? {})
  .flatMap(job => (job?.steps ?? []).map((step, stepIndex) => ({ job, step, stepIndex })))
  .filter(({ job, step }) =>
    job?.if == null &&
    (job?.['continue-on-error'] == null || job['continue-on-error'] === false) &&
    step?.run?.trim() === 'node scripts/verify-action-shas.mjs' &&
    step?.if == null &&
    (step?.['continue-on-error'] == null || step['continue-on-error'] === false)
  )
if (actionVerificationSteps.length === 0) {
  violations.push('.github/workflows/ci.yml: required upstream Action SHA verification is missing')
}
if (actionVerificationSteps.some(({ step }) => step?.env?.GITHUB_TOKEN)) {
  violations.push('.github/workflows/ci.yml: Action SHA verification must not receive GITHUB_TOKEN')
}
if (actionVerificationSteps.some(({ job, stepIndex }) =>
  !(job.steps ?? []).slice(0, stepIndex).some(step =>
    step?.run?.includes('pnpm install --frozen-lockfile')
  )
)) {
  violations.push('.github/workflows/ci.yml: Action SHA verification must run after the frozen install')
}
const prAuthorization = ci?.jobs?.['pr-authorization']
const requiredPrJobs = [
  'static-quality',
  'core-contracts',
  'docs-examples',
  'server-e2e',
  'pr-e2e-smoke',
]
if (
  prAuthorization?.name !== 'PR verification' ||
  !String(prAuthorization?.if ?? '').includes('always()') ||
  !isDeepStrictEqual(prAuthorization?.needs, requiredPrJobs)
) {
  violations.push('.github/workflows/ci.yml: PR verification must always evaluate every required PR lane')
}
const prAuthorizationSource = JSON.stringify(prAuthorization?.steps ?? [])
for (const job of requiredPrJobs) {
  if (!prAuthorizationSource.includes(`needs.${job}.result`)) {
    violations.push(`.github/workflows/ci.yml: PR verification does not validate ${job}`)
  }
}
if (renovate.minimumReleaseAge !== '1 day') {
  violations.push('renovate.json: minimumReleaseAge must match the 24-hour pnpm quarantine')
}

for (const requiredFile of [
  '.github/ISSUE_TEMPLATE/bug.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/documentation.md',
  '.github/ISSUE_TEMPLATE/proposal.md',
  '.github/pull_request_template.md',
]) {
  if (!trackedRepositoryFiles.includes(requiredFile)) {
    violations.push(`${requiredFile}: required contributor template is missing`)
  }
}

function withoutFencedCode(source) {
  let fence = null
  return source
    .split(/\r?\n/u)
    .map((line) => {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1]
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/u)?.[1]
      if (!fence && opening) {
        fence = opening
        return ''
      }
      if (fence && closing?.[0] === fence[0] && closing.length >= fence.length) {
        fence = null
        return ''
      }
      return fence ? '' : line
    })
    .join('\n')
}

function validatePublicReadme(filePath, source, headings) {
  const errors = []
  const markdown = withoutFencedCode(source)
  const actualHeadings = Array.from(markdown.matchAll(/^## (.+)$/gmu), match => match[1].trim())
  let cursor = -1
  for (const heading of headings) {
    const index = actualHeadings.indexOf(heading)
    if (index === -1) {
      errors.push(`${filePath} is missing the section: ${heading}`)
      continue
    }
    if (index < cursor) errors.push(`${filePath} has ${heading} out of order`)
    cursor = index
  }

  const header = source.match(
    /^<p align="center">\s*<img src="[^"]+" width="128" alt="[^"]+">\s*<\/p>\s*<h1 align="center">[^<\n]+<\/h1>\s*<p align="center">[\s\S]+?<\/p>\s*<p align="center">(?<badges>[\s\S]+?)<\/p>/u,
  )
  if (!header?.groups?.badges) {
    errors.push(`${filePath} must start with the centered icon, h1, value proposition, and badges`)
  } else {
    const badgeBlock = header.groups.badges
    for (const marker of [
      'href="https://www.npmjs.com/package/@lupinum/ginko-content"',
      'src="https://img.shields.io/npm/v/@lupinum/ginko-content',
      'href="https://github.com/lupinum-dev/ginko-content/actions/workflows/ci.yml"',
      'src="https://github.com/lupinum-dev/ginko-content/actions/workflows/ci.yml/badge.svg"',
      'license-MIT',
    ]) {
      if (!badgeBlock.includes(marker)) errors.push(`${filePath} is missing header badge marker: ${marker}`)
    }
  }

  const htmlH1Count = Array.from(markdown.matchAll(/<h1\b[^>]*>/giu)).length
  const markdownH1Count = Array.from(markdown.matchAll(/^#\s+\S.+$/gmu)).length
  if (htmlH1Count !== 1 || markdownH1Count !== 0) {
    errors.push(`${filePath} must contain exactly one centered HTML h1 and no Markdown h1`)
  }

  const releaseStatus = source.match(/^> Version `(?<version>[^`]+)` is a release candidate\./mu)
  if (packageManifest.version.includes('-')) {
    if (!source.includes('> [!WARNING]\n')) {
      errors.push(`${filePath} must use a warning for prerelease status`)
    }
    if (releaseStatus?.groups?.version !== packageManifest.version) {
      errors.push(`${filePath} must identify release candidate ${packageManifest.version}`)
    }
  } else if (releaseStatus) {
    errors.push(`${filePath} must not show a release-candidate notice for a stable version`)
  }

  if (/\b(?:TODO|TBD|placeholder)\b/iu.test(source)) {
    errors.push(`${filePath} contains unfinished placeholder text`)
  }
  return errors
}

const readmeContracts = new Map([
  ['README.md', [
  'Why use Ginko Content?',
  'When to use it',
  'Requirements',
  'Installation',
  'Quick start',
  'What the package provides',
  'Documentation',
  'Contributing and development',
  'Support and security',
  'License',
  ]],
  ['packages/content/README.md', [
  'Why use this package?',
  'Requirements',
  'Installation',
  'Quick start',
  'Main capabilities',
  'Documentation',
  'Support and security',
  'License',
  ]],
])

for (const [filePath, headings] of readmeContracts) {
  const source = readFileSync(join(repoRoot, filePath), 'utf8')
  violations.push(...validatePublicReadme(filePath, source, headings))
}

const rootReadme = readFileSync(join(repoRoot, 'README.md'), 'utf8')
const rootHeadings = readmeContracts.get('README.md')
const failureProbes = [
  {
    name: 'a required heading that exists only inside a code fence',
    source: `${rootReadme.replace('## Why use Ginko Content?', 'Why use Ginko Content?')}\n\`\`\`md\n## Why use Ginko Content?\n\`\`\`\n`,
    expected: 'missing the section: Why use Ginko Content?',
  },
  {
    name: 'an uncentered product heading',
    source: rootReadme.replace('<h1 align="center">', '<h1>'),
    expected: 'must start with the centered icon',
  },
  {
    name: 'a stale release status',
    source: rootReadme.replace(packageManifest.version, '0.0.0-stale.1'),
    expected: `must identify release candidate ${packageManifest.version}`,
  },
  {
    name: 'a second product heading',
    source: `${rootReadme}\n# Duplicate product heading\n`,
    expected: 'must contain exactly one centered HTML h1',
  },
  {
    name: 'a shorter closing fence that exposes a hidden heading',
    source: `${rootReadme.replace('## Why use Ginko Content?', 'Why use Ginko Content?')}\n\`\`\`\`md\n\`\`\`\n## Why use Ginko Content?\n\`\`\`\`\n`,
    expected: 'missing the section: Why use Ginko Content?',
  },
]
for (const probe of failureProbes) {
  const errors = validatePublicReadme('README.md', probe.source, rootHeadings)
  if (!errors.some(error => error.includes(probe.expected))) {
    violations.push(`README policy failure probe did not reject ${probe.name}`)
  }
}

const docsAppConfig = readFileSync(join(repoRoot, 'docs/app/app.config.ts'), 'utf8')
for (const marker of [
  "plausible: { scriptId: 'H5REVQ79vAvFqyHLSC2Ve' }",
  'feedback: { enabled: true }',
  'https://discord.gg/RPH6SeA36N',
  'https://lupinum.com/impressum',
  'https://lupinum.com/datenschutz',
]) {
  if (!docsAppConfig.includes(marker)) violations.push(`docs/app/app.config.ts is missing: ${marker}`)
}

const pullRequestTemplate = readFileSync(join(repoRoot, '.github/pull_request_template.md'), 'utf8')
for (const heading of [
  'Result',
  'Verification',
  'Documentation and compatibility',
  'Release note',
  'Risk',
]) {
  if (!pullRequestTemplate.includes(`## ${heading}`)) {
    violations.push(`.github/pull_request_template.md is missing the section: ${heading}`)
  }
}
for (const marker of [
  '- [ ] I ran `pnpm verify`, or I explained why it does not apply.',
  '- [ ] I updated versions, migration guidance, and compatibility notes when the public contract changed.',
]) {
  if (!pullRequestTemplate.includes(marker)) {
    violations.push(`.github/pull_request_template.md is missing: ${marker}`)
  }
}

const maintaining = readFileSync(join(repoRoot, 'MAINTAINING.md'), 'utf8')
for (const heading of [
  'Quick fixes',
  'Large changes',
  'Documentation changes',
  'Prepare a release',
  'Roll back a defective release',
  'Respond to a credential incident',
]) {
  if (!maintaining.includes(`## ${heading}`)) {
    violations.push(`MAINTAINING.md is missing the playbook: ${heading}`)
  }
}

const changelogLines = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8').split(/\r?\n/u)
const releaseHeading = `## v${packageManifest.version}`
const releaseHeadingIndex = changelogLines.indexOf(releaseHeading)
if (releaseHeadingIndex === -1) {
  violations.push(`CHANGELOG.md must contain the package release heading ${releaseHeading}`)
} else {
  const nextReleaseHeadingIndex = changelogLines.findIndex((line, index) =>
    index > releaseHeadingIndex && line.startsWith('## '))
  const releaseSection = changelogLines
    .slice(releaseHeadingIndex + 1, nextReleaseHeadingIndex === -1 ? undefined : nextReleaseHeadingIndex)
    .join('\n')
    .trim()
  if (!releaseSection) {
    violations.push(`CHANGELOG.md release section ${releaseHeading} must not be empty`)
  }
}

for (const filePath of collectFiles('.')) {
  if (relative(repoRoot, filePath).replaceAll('\\', '/') === 'scripts/check-repo-policies.mjs') {
    continue
  }
  const source = readFileSync(filePath, 'utf8')
  if (privateConsumerPattern.test(source)) {
    violations.push(`${relative(repoRoot, filePath)} references a private consumer app path/name`)
  }
  if (personalPathPattern.test(source)) {
    violations.push(`${relative(repoRoot, filePath)} contains a host-specific personal path`)
  }
  if ((filePath.endsWith('package.json') || filePath.endsWith('pnpm-lock.yaml')) && absoluteFileDependencyPattern.test(source)) {
    violations.push(`${relative(repoRoot, filePath)} contains an absolute filesystem dependency`)
  }
}

for (const root of cmsNeutralRuntimeRoots) {
  for (const filePath of collectFiles(root)) {
    const source = readFileSync(filePath, 'utf8')
    if (cmsRuntimeCouplingPattern.test(source)) {
      violations.push(`${relative(repoRoot, filePath)} couples runtime content code to Ginko CMS`)
    }
  }
}

const trackedIgnoredArtifacts = execFileSync(
  'git',
  ['ls-files', '-ci', '--exclude-standard', ...trackedIgnoredArtifactPathspecs],
  { cwd: repoRoot, encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)

for (const artifact of trackedIgnoredArtifacts) {
  violations.push(`${artifact} is an ignored generated/release artifact but is tracked`)
}

if (violations.length > 0) {
  console.error('Ginko Content repo policy check failed:')
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log('Ginko Content repo policy check passed.')
