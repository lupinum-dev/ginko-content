import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function assertOrderedHeadings(filePath, headings) {
  const source = readFileSync(join(repoRoot, filePath), 'utf8')
  let cursor = -1
  for (const heading of headings) {
    const index = source.indexOf(`## ${heading}`)
    if (index === -1) {
      violations.push(`${filePath} is missing the section: ${heading}`)
      continue
    }
    if (index < cursor) violations.push(`${filePath} has ${heading} out of order`)
    cursor = index
  }

  if ((source.match(/<h1\b/gu) ?? []).length !== 1) {
    violations.push(`${filePath} must contain one centered HTML h1`)
  }
  if (!/<img[^>]+width="128"[^>]*>/u.test(source)) {
    violations.push(`${filePath} must contain a 128 px product icon`)
  }
  for (const marker of ['align="center"', 'npmjs.com/package/@lupinum/ginko-content', 'actions/workflows/ci.yml', 'MIT']) {
    if (!source.includes(marker)) violations.push(`${filePath} is missing README marker: ${marker}`)
  }
  if (/\b(?:TODO|TBD|placeholder)\b/iu.test(source)) {
    violations.push(`${filePath} contains unfinished placeholder text`)
  }
  if (source.includes('0.4.0-rc.1')) {
    violations.push(`${filePath} contains the previous release-candidate version`)
  }
}

assertOrderedHeadings('README.md', [
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
])
assertOrderedHeadings('packages/content/README.md', [
  'Why use this package?',
  'Requirements',
  'Installation',
  'Quick start',
  'Main capabilities',
  'Documentation',
  'Support and security',
  'License',
])

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

const packageManifest = JSON.parse(readFileSync(join(repoRoot, 'packages/content/package.json'), 'utf8'))
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
