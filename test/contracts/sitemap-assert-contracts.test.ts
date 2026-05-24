import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  assertGeneratedSitemaps,
  createSitemapAssertionTargetsFromPrerenderedSitemaps,
  normalizeContentSitemapAssertOptions,
  shouldRunSitemapAssertionOnCompiled,
  shouldRunSitemapAssertionOnPrerenderedSitemaps
} from '../../packages/content/src/module/sitemap-assert'

const createOutputDir = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), 'content-sitemap-assert-'))

  for (const [file, contents] of Object.entries(files)) {
    const target = join(root, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }

  return root
}

describe('sitemap assertion contracts', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('normalizes sitemap assert defaults', () => {
    expect(normalizeContentSitemapAssertOptions()).toEqual({
      enabled: false,
      mode: 'generate',
      allowEmpty: false,
      minUrlsPerSitemap: 1,
      requireImages: false,
      requiredCollections: [],
      sitemaps: {}
    })
  })

  test('runs on the correct build hooks for build and generate modes', () => {
    const generateOptions = normalizeContentSitemapAssertOptions({ enabled: true, mode: 'generate' })
    const buildOptions = normalizeContentSitemapAssertOptions({ enabled: true, mode: 'build' })
    const bothOptions = normalizeContentSitemapAssertOptions({ enabled: true, mode: 'both' })

    expect(shouldRunSitemapAssertionOnCompiled(generateOptions, { options: { static: true } })).toBe(false)
    expect(shouldRunSitemapAssertionOnPrerenderedSitemaps(generateOptions)).toBe(true)
    expect(shouldRunSitemapAssertionOnCompiled(buildOptions, { options: { static: false } })).toBe(true)
    expect(shouldRunSitemapAssertionOnPrerenderedSitemaps(buildOptions)).toBe(false)
    expect(shouldRunSitemapAssertionOnCompiled(bothOptions, { options: { static: false } })).toBe(true)
    expect(shouldRunSitemapAssertionOnPrerenderedSitemaps(bothOptions)).toBe(true)
  })

  test('passes with discovered child sitemaps and per-sitemap overrides', async () => {
    const outputDir = await createOutputDir({
      'sitemap_index.xml': [
        '<sitemapindex>',
        '<sitemap><loc>https://example.test/__sitemap__/en-US.xml</loc></sitemap>',
        '<sitemap><loc>https://example.test/__sitemap__/de-DE.xml</loc></sitemap>',
        '</sitemapindex>'
      ].join(''),
      '__sitemap__/en-US.xml': '<urlset><url></url><image:image></image:image></urlset>',
      '__sitemap__/de-DE.xml': '<urlset></urlset>'
    })
    tempDirs.push(outputDir)

    await expect(assertGeneratedSitemaps({
      outputPublicDir: outputDir,
      options: normalizeContentSitemapAssertOptions({
        enabled: true,
        requireImages: true,
        requiredCollections: ['docs'],
        sitemaps: {
          'de-DE': {
            allowEmpty: true,
            requireImages: false
          }
        }
      }),
      collectionRouteCounts: {
        docs: 2
      }
    })).resolves.toBeUndefined()
  })

  test('fails when a sitemap is empty below the minimum threshold', async () => {
    const outputDir = await createOutputDir({
      'sitemap_index.xml': '<sitemapindex><sitemap><loc>/__sitemap__/en-US.xml</loc></sitemap></sitemapindex>',
      '__sitemap__/en-US.xml': '<urlset></urlset>'
    })
    tempDirs.push(outputDir)

    await expect(assertGeneratedSitemaps({
      outputPublicDir: outputDir,
      options: normalizeContentSitemapAssertOptions({
        enabled: true,
        minUrlsPerSitemap: 2
      }),
      collectionRouteCounts: {}
    })).rejects.toThrow('en-US: 0 URLs, expected at least 2')
  })

  test('fails when image entries are required but missing', async () => {
    const outputDir = await createOutputDir({
      'sitemap_index.xml': '<sitemapindex><sitemap><loc>/__sitemap__/en-US.xml</loc></sitemap></sitemapindex>',
      '__sitemap__/en-US.xml': '<urlset><url></url></urlset>'
    })
    tempDirs.push(outputDir)

    await expect(assertGeneratedSitemaps({
      outputPublicDir: outputDir,
      options: normalizeContentSitemapAssertOptions({
        enabled: true,
        requireImages: true
      }),
      collectionRouteCounts: {}
    })).rejects.toThrow('expected image entries but found none')
  })

  test('fails when required collections do not contribute any routes', async () => {
    const outputDir = await createOutputDir({
      'sitemap_index.xml': '<sitemapindex><sitemap><loc>/__sitemap__/en-US.xml</loc></sitemap></sitemapindex>',
      '__sitemap__/en-US.xml': '<urlset><url></url></urlset>'
    })
    tempDirs.push(outputDir)

    await expect(assertGeneratedSitemaps({
      outputPublicDir: outputDir,
      options: normalizeContentSitemapAssertOptions({
        enabled: true,
        requiredCollections: ['docs', 'posts']
      }),
      collectionRouteCounts: {
        docs: 1,
        posts: 0
      }
    })).rejects.toThrow('Missing content sitemap routes for collections: posts')
  })

  test('creates assertion targets from finalized prerendered sitemaps', async () => {
    const targets = createSitemapAssertionTargetsFromPrerenderedSitemaps([
      {
        name: '/sitemap_index.xml',
        content: [
          '<sitemapindex>',
          '<sitemap><loc>https://example.test/__sitemap__/en-US.xml</loc></sitemap>',
          '<sitemap><loc>https://example.test/__sitemap__/de-DE.xml</loc></sitemap>',
          '</sitemapindex>'
        ].join('')
      },
      {
        name: '/__sitemap__/en-US.xml',
        content: '<urlset><url></url><image:image></image:image></urlset>'
      },
      {
        name: '/__sitemap__/de-DE.xml',
        content: '<urlset><url></url></urlset>'
      }
    ])

    await expect(assertGeneratedSitemaps({
      options: normalizeContentSitemapAssertOptions({
        enabled: true,
        requireImages: false
      }),
      collectionRouteCounts: {},
      targets
    })).resolves.toBeUndefined()
  })

  test('supports single-root sitemap payloads from the final prerender hook', async () => {
    const targets = createSitemapAssertionTargetsFromPrerenderedSitemaps([
      {
        name: '/sitemap.xml',
        content: '<urlset><url></url></urlset>'
      }
    ])

    await expect(assertGeneratedSitemaps({
      options: normalizeContentSitemapAssertOptions({
        enabled: true,
        minUrlsPerSitemap: 1
      }),
      collectionRouteCounts: {},
      targets
    })).resolves.toBeUndefined()
  })
})
