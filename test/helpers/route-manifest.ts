import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect } from 'vitest'
import { listGeneratedFiles } from './generated-artifacts'

export interface RouteManifestOptions {
  presenceOnlyDirs?: string[]
}

export type RouteManifestLane = 'build' | 'generate'
type RouteManifestScope = 'build+generate' | 'generate-only'

const defaultPresenceOnlyDirs = ['pagefind']
const stableArtifactPattern = /\.(?:html|xml|txt|md)$/
const searchIndexPath = 'api/_content/search/index.json'
const sitemapDirPrefix = '__sitemap__/'
const volatileArtifactPatterns = [
  /^_nuxt\//,
  /^_i18n\//,
  /(?:^|\/)_payload\.json$/,
  /^api\/_content\/cache\.\d+\.json$/,
  // During prerendering the content cache/build route responds with HTML (a
  // route-injection seed for Nitro's crawler — see
  // `runtime/server/api/cache.ts`), which Nitro's own content-type-based
  // rename writes as `<route>/index.html` (subfolder-index output, matching
  // `nitro.options.prerender.autoSubfolderIndex`) instead of the original
  // `.json` route path. Checked BEFORE `stableArtifactPattern` below (which
  // would otherwise treat any `.html`-suffixed path as stable) since the
  // filename embeds a non-deterministic build timestamp and must never
  // enter the golden.
  /^api\/_content\/cache\.\d+\.json\/index\.html$/,
  /^api\/_content\/cache\.\d+\.json\.html$/,
  /^api\/_content\/(?:navigation|query)\//,
  // In i18n mode `/sitemap.xml` (and locale-prefixed aliases like
  // `/de/sitemap.xml`) redirect to `sitemap_index.xml`; whether the prerender
  // crawler materializes those redirects as `<route>/index.html` stubs varies
  // by Nuxt/Nitro version (Nuxt 4.5 stopped emitting the locale-prefixed one).
  // The canonical sitemap artifacts (`sitemap_index.xml`, `__sitemap__/*.xml`)
  // remain stable golden entries.
  /(?:^|\/)sitemap\.xml\/index\.html$/
]

function normalizeSlashes (path: string) {
  return path.replace(/\\/g, '/').replace(/^\.?\/+/, '')
}

function isKnownVolatileArtifact (path: string) {
  return volatileArtifactPatterns.some(pattern => pattern.test(path))
}

/**
 * Classifies every emitted file. Stable public output is included, known volatile framework
 * output is excluded, and unknown output fails closed so new artifact types cannot disappear
 * silently from release review.
 */
export function normalizeRouteManifest (
  files: string[],
  options: RouteManifestOptions = {}
): string[] {
  const presenceOnlyDirs = options.presenceOnlyDirs ?? defaultPresenceOnlyDirs
  const entries = new Set<string>()
  const unknown: string[] = []

  for (const rawPath of files) {
    const path = normalizeSlashes(rawPath)
    if (!path) continue

    const presenceDir = presenceOnlyDirs.find(dir => path === dir || path.startsWith(`${dir}/`))
    if (presenceDir) {
      entries.add(`${presenceDir}/ (present)`)
      continue
    }

    if (isKnownVolatileArtifact(path)) continue

    if (
      path === searchIndexPath ||
      path.startsWith(sitemapDirPrefix) ||
      stableArtifactPattern.test(path)
    ) {
      entries.add(path)
      continue
    }
    unknown.push(path)
  }

  if (unknown.length > 0) {
    throw new Error(
      'Route manifest found unclassified generated output. Classify each path as stable or explicitly volatile:\n' +
      unknown.sort().map(path => `  - ${path}`).join('\n')
    )
  }

  return [...entries].sort()
}

export function formatRouteManifest (entries: string[]): string {
  return entries.length > 0 ? `${entries.join('\n')}\n` : ''
}

export function parseSemanticRouteGolden (text: string): Map<string, RouteManifestScope> {
  const entries = new Map<string, RouteManifestScope>()
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const match = /^(build\+generate|generate-only) (.+)$/.exec(line)
    if (!match) throw new Error(`Invalid semantic route golden line: ${line}`)
    const [, scope, path] = match as [string, RouteManifestScope, string]
    if (entries.has(path)) throw new Error(`Duplicate semantic route golden path: ${path}`)
    entries.set(path, scope)
  }
  return entries
}

function formatSemanticRouteGolden (entries: Map<string, RouteManifestScope>): string {
  return [...entries]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, scope]) => `${scope} ${path}`)
    .join('\n') + '\n'
}

export async function buildRouteManifest (
  publicDir: string,
  options: RouteManifestOptions = {}
): Promise<string[]> {
  return normalizeRouteManifest(await listGeneratedFiles(publicDir), options)
}

export function navigableRoutesFromManifest (entries: string[]): string[] {
  return entries
    .filter(entry => entry.endsWith('.html'))
    .filter(entry => !['200.html', '404.html', '404/index.html'].includes(entry))
    .filter(entry => !entry.startsWith('sitemap'))
    .map((entry) => {
      if (entry === 'index.html') return '/'
      if (entry.endsWith('/index.html')) return `/${entry.slice(0, -'/index.html'.length)}`
      return `/${entry.slice(0, -'.html'.length)}`
    })
    .sort()
}

export async function assertRouteManifestMatchesGolden (
  publicDir: string,
  goldenPath: string,
  lane: RouteManifestLane,
  options: RouteManifestOptions = {}
) {
  const actualEntries = await buildRouteManifest(publicDir, options)

  if (process.env.UPDATE_ROUTE_GOLDENS === '1') {
    if (lane !== 'generate') throw new Error('Route goldens may only be regenerated from the complete generate lane')
    let existing = new Map<string, RouteManifestScope>()
    try {
      existing = parseSemanticRouteGolden(await readFile(goldenPath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const updated = new Map(actualEntries.map(path => [path, existing.get(path) ?? 'generate-only']))
    await mkdir(dirname(goldenPath), { recursive: true })
    await writeFile(goldenPath, formatSemanticRouteGolden(updated))
    return
  }

  const semanticGolden = parseSemanticRouteGolden(await readFile(goldenPath, 'utf8'))
  const expectedEntries = [...semanticGolden]
    .filter(([, scope]) => lane === 'generate' || scope === 'build+generate')
    .map(([path]) => path)
    .sort()
  expect(
    actualEntries,
    `${lane} route manifest for ${publicDir} does not match semantic golden ${goldenPath}.\n` +
    'If this is intentional, run "pnpm golden:update" and review the diff.'
  ).toEqual(expectedEntries)
}
