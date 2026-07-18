import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

function collectFiles(rootPath) {
  const absoluteRoot = resolve(repoRoot, rootPath)
  if (!existsSync(absoluteRoot)) return []
  const stats = statSync(absoluteRoot)
  if (stats.isFile()) return [absoluteRoot]

  const files = []
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue
      files.push(...collectFiles(join(rootPath, entry.name)))
      continue
    }
    if (!entry.isFile()) continue
    const filePath = join(absoluteRoot, entry.name)
    if (scannedExtensions.has(extname(filePath))) files.push(filePath)
  }
  return files
}

const violations = []

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
