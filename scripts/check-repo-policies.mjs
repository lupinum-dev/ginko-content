import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignoredDirs = new Set(['.git', '.nuxt', '.output', '.pack', 'dist', 'node_modules'])
const scannedExtensions = new Set(['.js', '.json', '.md', '.mjs', '.ts', '.vue'])
const privateConsumerPattern = /i18n-cms|\/_temp\/i18n-cms|\/Users\/matthias\/Git\/_temp/
const cmsRuntimeCouplingPattern = /@lupinum\/ginko-cms/
const cmsNeutralRuntimeRoots = [
  'packages/content/src/core',
  'packages/content/src/features',
  'packages/content/src/integrations',
  'packages/content/src/parsers',
  'packages/content/src/public',
  'packages/content/src/runtime',
  'packages/content/src/storage',
]
const trackedIgnoredArtifactPathspecs = [
  ':(glob)**/.pack/**',
  ':(glob)**/dist/**',
  ':(glob)**/.nuxt/**',
  ':(glob)**/.output/**'
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

for (const filePath of collectFiles('.')) {
  if (relative(repoRoot, filePath).replaceAll('\\', '/') === 'scripts/check-repo-policies.mjs') {
    continue
  }
  const source = readFileSync(filePath, 'utf8')
  if (privateConsumerPattern.test(source)) {
    violations.push(`${relative(repoRoot, filePath)} references a private consumer app path/name`)
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
