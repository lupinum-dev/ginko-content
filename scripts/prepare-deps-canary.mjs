import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (!['minimum-supported', 'latest-supported', 'future'].includes(mode)) {
  console.error('Usage: node scripts/prepare-deps-canary.mjs <minimum-supported|latest-supported|future>')
  process.exit(2)
}
if (process.env.GITHUB_ACTIONS !== 'true' && !process.argv.includes('--allow-local')) {
  console.error('Dependency canary manifest rewriting is allowed only in an ephemeral GitHub Actions checkout. Pass --allow-local only in a disposable checkout.')
  process.exit(2)
}

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignored = new Set(['.git', '.nuxt', '.output', '.pack', 'dist', 'node_modules'])
const fields = ['dependencies', 'devDependencies', 'optionalDependencies']
const latestSupported = {
  '@comark/vue': '^0.4.0',
  'beautiful-mermaid': '^1.1.3',
  '@nuxt/kit': '^4.4.7',
  '@nuxt/schema': '^4.4.7',
  '@nuxt/test-utils': '^4.0.3',
  '@nuxtjs/i18n': '^10.3.0',
  '@nuxtjs/sitemap': '>=8.0.15 <9',
  'comark': '^0.4.0',
  'katex': '^0.16.47',
  'nuxt': '^4.4.7',
  'nuxt-site-config': '^4.0.8',
  'pagefind': '^1.5.2',
  'vitest': '^4.1.6',
  'vue': '^3.5.35'
}
async function resolveFutureNuxtVersion () {
  const packages = ['nuxt', '@nuxt/kit', '@nuxt/schema']
  const tags = await Promise.all(packages.map(async (name) => {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
    if (!response.ok) throw new Error(`Unable to resolve npm dist-tags for ${name}: ${response.status}`)
    return (await response.json())['dist-tags']
  }))
  return tags.every(packageTags => packageTags?.next) ? 'next' : 'latest'
}
const futureNuxtVersion = mode === 'future'
  ? process.env.GINKO_CANARY_NUXT_VERSION || await resolveFutureNuxtVersion()
  : undefined
const future = {
  ...latestSupported,
  '@nuxt/kit': futureNuxtVersion,
  '@nuxt/schema': futureNuxtVersion,
  'nuxt': futureNuxtVersion
}
const versions = mode === 'minimum-supported' ? {} : mode === 'latest-supported' ? latestSupported : future

function packageJsonFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) files.push(...packageJsonFiles(join(directory, entry.name)))
    } else if (entry.isFile() && entry.name === 'package.json') {
      files.push(join(directory, entry.name))
    }
  }
  return files
}

const changes = []
for (const file of packageJsonFiles(repoRoot)) {
  if (!existsSync(file)) continue
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  let changed = false
  for (const field of fields) {
    for (const [name, version] of Object.entries(versions)) {
      if (!manifest[field]?.[name] || manifest[field][name] === version) continue
      changes.push({ file: relative(repoRoot, file).replaceAll('\\', '/'), field, name, from: manifest[field][name], to: version })
      manifest[field][name] = version
      changed = true
    }
  }
  if (changed) writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
}

console.log(JSON.stringify({ mode, futureNuxtVersion, changes }, null, 2))
