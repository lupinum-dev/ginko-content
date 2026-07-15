import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ContentSitemapAssertOptions, ResolvedContentContext } from '../types/module'
import { isContentSnapshot } from '../core/content/snapshot'
import { computeSitemapCollectionCounts } from '../features/sitemap/counts'

export type NormalizedContentSitemapAssertOptions = {
  enabled: boolean
  mode: 'generate' | 'build' | 'both'
  allowEmpty: boolean
  minUrlsPerSitemap: number
  requireImages: boolean
  requiredCollections: string[]
  requiredPaths: string[]
  forbiddenPathPrefixes: string[]
  requireProductionSiteUrl: boolean
  sitemaps: Record<string, {
    allowEmpty?: boolean
    minUrls?: number
    requireImages?: boolean
  }>
}

type SitemapAssertionTarget = {
  name: string
  path?: string
  xml: string
}

type GeneratedSitemapLike = {
  name: string
  content: string
}

type SitemapAssertionContext = {
  options: NormalizedContentSitemapAssertOptions
  collectionRouteCounts: Record<string, number>
  outputPublicDir?: string
  targets?: SitemapAssertionTarget[]
  logger?: { info: (message: string) => void }
}

const SITEMAP_INDEX = 'sitemap_index.xml'

const countTag = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}>`, 'g')) || []).length

const extractLocValues = (xml: string) => {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), match => match[1])
}

const toLocalPath = (value: string) => {
  try {
    return new URL(value).pathname
  }
  catch {
    return value
  }
}

const placeholderHosts = new Set([
  'example.com',
  'example.net',
  'example.org',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1'
])

const isPlaceholderHost = (host: string) =>
  placeholderHosts.has(host) ||
  host.endsWith('.example.com') ||
  host.endsWith('.example.net') ||
  host.endsWith('.example.org') ||
  host.endsWith('.localhost')

const extractPlaceholderSiteUrls = (locValues: string[]) => Array.from(new Set(locValues.filter((value) => {
  try {
    return isPlaceholderHost(new URL(value).hostname)
  }
  catch {
    return false
  }
})))

const discoverSitemapsFromDisk = async (outputPublicDir: string): Promise<SitemapAssertionTarget[]> => {
  const indexPath = join(outputPublicDir, SITEMAP_INDEX)
  try {
    const sitemapIndex = await readFile(indexPath, 'utf8')
    const locValues = extractLocValues(sitemapIndex)
    const discovered = locValues
      .map(toLocalPath)
      .filter(path => path.endsWith('.xml') && path !== '/sitemap.xml' && path !== '/sitemap_index.xml')
      .map((path) => {
        const normalizedPath = path.replace(/^\/+/, '')
        return {
          name: basename(normalizedPath, '.xml'),
          path: join(outputPublicDir, normalizedPath)
        }
      })

    if (discovered.length > 0) {
      return Promise.all(discovered.map(async target => ({
        ...target,
        xml: await readFile(target.path, 'utf8')
      })))
    }
  }
  catch {
    // Fall through to the child-sitemap directory. Nuxt Sitemap can emit the locale XMLs even when
    // the top-level index file shape varies across dev/build/generate or is written later.
  }

  const children: SitemapAssertionTarget[] = []
  const sitemapDir = join(outputPublicDir, '__sitemap__')
  try {
    const sitemapFiles = (await readdir(sitemapDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.xml'))
      .map(entry => ({
        name: basename(entry.name, '.xml'),
        path: join(sitemapDir, entry.name)
      }))

    children.push(...await Promise.all(sitemapFiles.map(async target => ({
      ...target,
      xml: await readFile(target.path, 'utf8')
    }))))
  }
  catch {
    // Single-sitemap installs do not emit a child sitemap directory.
  }

  if (children.length > 0) {
    return children
  }

  const rootSitemapPath = join(outputPublicDir, 'sitemap.xml')
  const rootSitemapXml = await readFile(rootSitemapPath, 'utf8')
  if (!(countTag(rootSitemapXml, 'url') > 0 || rootSitemapXml.includes('<urlset'))) {
    throw new Error(`Content sitemap assertion failed: no child sitemap files were discovered in ${indexPath} or ${sitemapDir}, and ${rootSitemapPath} is not a urlset sitemap.`)
  }

  return [{
    name: 'sitemap',
    path: rootSitemapPath,
    xml: rootSitemapXml
  }]
}

export const normalizeContentSitemapAssertOptions = (
  options?: ContentSitemapAssertOptions
): NormalizedContentSitemapAssertOptions => ({
  enabled: options?.enabled ?? false,
  mode: options?.mode ?? 'generate',
  allowEmpty: options?.allowEmpty ?? false,
  minUrlsPerSitemap: options?.minUrlsPerSitemap ?? 1,
  requireImages: options?.requireImages ?? false,
  requiredCollections: options?.requiredCollections ?? [],
  requiredPaths: options?.requiredPaths ?? [],
  forbiddenPathPrefixes: options?.forbiddenPathPrefixes ?? [],
  requireProductionSiteUrl: options?.requireProductionSiteUrl ?? false,
  sitemaps: options?.sitemaps ?? {}
})

export const shouldRunSitemapAssertionOnCompiled = (
  options: NormalizedContentSitemapAssertOptions,
  nitro: { options: { static?: boolean, preset?: string } }
) => {
  const isStaticLikeBuild = nitro.options.static || nitro.options.preset === 'static'
  if (!options.enabled || isStaticLikeBuild) {
    return false
  }

  return options.mode === 'build' || options.mode === 'both'
}

export const shouldRunSitemapAssertionOnPrerenderedSitemaps = (
  options: NormalizedContentSitemapAssertOptions
) => options.enabled && options.mode !== 'build'

export async function assertGeneratedSitemaps ({
  options,
  collectionRouteCounts,
  outputPublicDir,
  targets,
  logger
}: SitemapAssertionContext) {
  const discoveredSitemaps = targets || (outputPublicDir
    ? await discoverSitemapsFromDisk(outputPublicDir)
    : [])
  if (discoveredSitemaps.length === 0) {
    throw new Error('Content sitemap assertion failed: no sitemap targets were available for validation.')
  }
  const targetMap = new Map(discoveredSitemaps.map(target => [target.name, target]))
  const failures: string[] = []

  for (const sitemapName of Object.keys(options.sitemaps)) {
    if (!targetMap.has(sitemapName)) {
      const sourceDescription = outputPublicDir
        ? join(outputPublicDir, SITEMAP_INDEX)
        : 'prerendered sitemap_index.xml'
      failures.push(`- Missing sitemap "${sitemapName}" in ${sourceDescription}`)
    }
  }

  for (const target of targetMap.values()) {
    const overrides = options.sitemaps[target.name] || {}
    const allowEmpty = overrides.allowEmpty ?? options.allowEmpty
    const minUrls = overrides.minUrls ?? options.minUrlsPerSitemap
    const requireImages = overrides.requireImages ?? options.requireImages
    const urlCount = countTag(target.xml, 'url')
    const imageCount = countTag(target.xml, 'image:image')

    if (!allowEmpty && urlCount < minUrls) {
      failures.push(`- ${target.name}: ${urlCount} URLs, expected at least ${minUrls}`)
    }

    if (requireImages && imageCount === 0) {
      failures.push(`- ${target.name}: expected image entries but found none`)
    }
  }

  const sitemapLocValues = discoveredSitemaps.flatMap(target => extractLocValues(target.xml))
  const sitemapPaths = Array.from(new Set(sitemapLocValues.map(toLocalPath)))
  const pathSet = new Set(sitemapPaths)
  const missingPaths = options.requiredPaths.filter(path => !pathSet.has(path))
  if (missingPaths.length) {
    failures.push(`- Missing required sitemap paths: ${missingPaths.join(', ')}`)
  }

  const forbiddenPaths = sitemapPaths.filter(path =>
    options.forbiddenPathPrefixes.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
  )
  if (forbiddenPaths.length) {
    failures.push(`- Forbidden sitemap paths found: ${forbiddenPaths.join(', ')}`)
  }

  if (options.requireProductionSiteUrl) {
    const placeholderSiteUrls = extractPlaceholderSiteUrls(sitemapLocValues)
    if (placeholderSiteUrls.length) {
      failures.push([
        `- Placeholder sitemap URLs found: ${placeholderSiteUrls.join(', ')}`,
        'Expected production URLs in generated sitemap loc values.',
        'Set site.url or runtimeConfig.public.content.siteUrl to the deployed origin for production release checks.'
      ].join(' '))
    }
  }

  const missingCollections = options.requiredCollections.filter((collection) => (collectionRouteCounts[collection] || 0) === 0)
  if (missingCollections.length) {
    failures.push(`- Missing content sitemap routes for collections: ${missingCollections.join(', ')}`)
  }

  if (failures.length) {
    throw new Error(`Content sitemap assertion failed:\n${failures.join('\n')}`)
  }

  logger?.info(`Content sitemap assertion passed for ${targetMap.size} sitemap${targetMap.size === 1 ? '' : 's'}.`)
}

export const createSitemapAssertionTargetsFromPrerenderedSitemaps = (sitemaps: GeneratedSitemapLike[]) => {
  const targets = sitemaps
    .map((sitemap) => {
      const path = toLocalPath(sitemap.name)
      const name = basename(path, '.xml')

      return {
        name,
        path,
        xml: sitemap.content
      }
    })
    .filter((target) => {
      if (target.name === 'sitemap_index') {
        return false
      }

      if (target.name === 'sitemap') {
        return target.xml.includes('<urlset')
      }

      return true
    })

  if (targets.length === 0) {
    throw new Error('Content sitemap assertion failed: no sitemap urlsets were available from sitemap:prerender:done.')
  }
  return targets
}

/**
 * Sitemap collection route counts for the `sitemap:prerender:done` assertion
 * (generate/'both' mode). This Nuxt-level hook fires in the Nuxt CLI process
 * after the ENTIRE prerender crawl — including the content cache/build
 * route that produces and persists the canonical snapshot
 * (`runtime/server/api/cache.ts`) — has already completed, so by this point
 * `<buildDir>/content-cache/snapshot.json` exists on disk. Reading it back
 * and re-deriving counts through `computeSitemapCollectionCounts` is a
 * rebuildable view over the canonical persisted snapshot (VNEXT §14.2), not
 * a second content-file parse — replaces the deleted module-time
 * `module/derived-route-discovery.ts#collectSitemapCollectionRouteCounts`.
 *
 * Returns an empty count map (rather than throwing) when the snapshot is
 * absent — e.g. an external provider build, or `content.sitemap.assert`
 * enabled without a filesystem-backed build — mirroring the prior
 * best-effort behavior for non-filesystem providers.
 */
export const readPersistedSitemapCollectionCounts = async (
  buildDir: string,
  contentContext: Pick<ResolvedContentContext, 'locales' | 'defaultLocale' | 'collections' | 'sitemap'>
): Promise<Record<string, number>> => {
  let raw: string
  try {
    raw = await readFile(join(buildDir, 'content-cache/snapshot.json'), 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }

  const snapshot = JSON.parse(raw)
  if (!isContentSnapshot(snapshot)) {
    throw new Error('[content] sitemap assertion: persisted content-cache/snapshot.json is invalid.')
  }

  return computeSitemapCollectionCounts(snapshot.documents, contentContext)
}
