import { readFile } from 'node:fs/promises'
import { expect } from 'vitest'
import { listGeneratedFiles } from './generated-artifacts'

export interface RouteManifestOptions {
  /**
   * Root-relative directory names whose entire contents collapse into a single presence marker
   * instead of being enumerated file-by-file (R-3) -- e.g. Pagefind's static asset bundle, whose
   * filenames are content-hash-derived and would churn the golden file on every content edit
   * while carrying no route information.
   */
  presenceOnlyDirs?: string[]
}

const defaultPresenceOnlyDirs = ['pagefind']

// R-3: manifests capture *routes and named artifacts* -- HTML pages, sitemaps, `llms*.txt`,
// `raw/**.md`, the search index, `robots.txt` -- not bundler output. Rather than trying to
// pattern-match every hash-named path Nuxt/Nitro might emit (`_nuxt/<hash>.js`,
// `_i18n/<hash>/**`, `api/_content/query/<hash>/**`, `api/_content/navigation/<hash>/**`,
// `api/_content/cache.<timestamp>.json`, per-route `_payload.json`), this normalizes by
// *inclusion*: only paths matching a known named-artifact shape survive. Anything else is bundler
// output and is silently dropped. This is deliberately the opposite of an exclude-list -- an
// exclude-list has to be updated every time Nitro adds a new hash-named output kind (and misses
// go straight into golden-file churn, C-14); an include-list only needs updating when a genuinely
// new *named* artifact kind ships (which already requires touching `generated-artifacts.ts`'s
// `textArtifactPattern`, C-5, in the same PR).
const namedArtifactExtensionPattern = /\.(?:html|xml|txt|md)$/
const searchIndexPath = 'api/_content/search/index.json'
const sitemapDirPrefix = '__sitemap__/'

function normalizeSlashes (path: string) {
  return path.replace(/\\/g, '/').replace(/^\.?\/+/, '')
}

/**
 * Pure normalization function (T2-1): given a flat list of relative paths under a `.output/public`
 * directory, returns the sorted, deduplicated set of manifest-worthy entries per R-3.
 */
export function normalizeRouteManifest (
  files: string[],
  options: RouteManifestOptions = {}
): string[] {
  const presenceOnlyDirs = options.presenceOnlyDirs ?? defaultPresenceOnlyDirs
  const entries = new Set<string>()

  for (const rawPath of files) {
    const path = normalizeSlashes(rawPath)
    if (!path) continue

    const presenceDir = presenceOnlyDirs.find(dir => path === dir || path.startsWith(`${dir}/`))
    if (presenceDir) {
      entries.add(`${presenceDir}/ (present)`)
      continue
    }

    if (path === searchIndexPath) {
      entries.add(path)
      continue
    }

    if (path.startsWith(sitemapDirPrefix)) {
      entries.add(path)
      continue
    }

    if (namedArtifactExtensionPattern.test(path)) {
      entries.add(path)
    }

    // else: hash-named bundler output (_nuxt/*, per-route _payload.json,
    // api/_content/{query,navigation}/**, api/_content/cache.*.json, _i18n/<hash>/**, etc.) --
    // excluded per R-3, not a route or named artifact.
  }

  return [...entries].sort((a, b) => a.localeCompare(b))
}

/** R-2: golden format is sorted, newline-delimited text, one path per line, trailing newline. */
export function formatRouteManifest (entries: string[]): string {
  return entries.length > 0 ? `${entries.join('\n')}\n` : ''
}

export async function buildRouteManifest (
  publicDir: string,
  options: RouteManifestOptions = {}
): Promise<string[]> {
  const files = await listGeneratedFiles(publicDir)
  return normalizeRouteManifest(files, options)
}

/**
 * R-2: compared with plain string equality (never `toMatchSnapshot`) so a route regression shows
 * up as a small, readable text diff instead of a rubber-stamped blob.
 */
export async function assertRouteManifestMatchesGolden (
  publicDir: string,
  goldenPath: string,
  options: RouteManifestOptions = {}
) {
  const entries = await buildRouteManifest(publicDir, options)
  const actualText = formatRouteManifest(entries)
  const goldenText = await readFile(goldenPath, 'utf8')

  expect(
    actualText,
    `route manifest for ${publicDir} does not match golden ${goldenPath}.\n` +
    'If this diff is an intentional route-shape change, regenerate with "pnpm golden:update" and review the diff before committing.'
  ).toBe(goldenText)
}
