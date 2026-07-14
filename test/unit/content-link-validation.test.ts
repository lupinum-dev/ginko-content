import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { ParsedContent } from '../../packages/content/src/types/content'
import type { ContentRouteRecord } from '../../packages/content/src/features/localization/route-projector'
import { buildContentGraph } from '../../packages/content/src/core/content/graph'
import { runContentValidation } from '../../packages/content/src/cli/validate'
import { validateContentLinks } from '../../packages/content/src/features/validation/links'

const document = (path: string, children: unknown[], file: string, locale = 'en'): ParsedContent => ({
  id: `content:${file}#${locale}`,
  path,
  canonicalKey: file.replace(/\.md$/, ''),
  collection: 'docs',
  locale,
  type: 'markdown',
  draft: false,
  partial: false,
  body: { type: 'root', children } as ParsedContent['body'],
  file: { source: 'content', path: file, stem: file.replace(/\.md$/, ''), extension: 'md' }
})

const element = (tag: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({ type: 'element', tag, props, children })
const route = (item: ParsedContent, path: string): ContentRouteRecord => ({
  collection: item.collection!, canonicalKey: item.canonicalKey!, locale: item.locale!, contentPath: item.path!, path, draft: false, sitemap: true
})

describe('content link validation', () => {
  test('uses projected content routes and resolved Nuxt routes without accepting catch-alls as proof', async () => {
    const home = document('/', [
      element('a', { href: '/de/leitfaden#overview' }),
      element('a', { href: '/users-admin' }),
      element('a', { href: '/definitely-missing' })
    ], 'index.md', 'de')
    const guide = document('/leitfaden', [element('h2', { id: 'overview' })], 'guide.md', 'de')
    const documents = [home, guide]

    const findings = await validateContentLinks(documents, {
      routes: [route(home, '/de'), route(guide, '/de/leitfaden')],
      graph: buildContentGraph(documents, { locales: ['en', 'de'], defaultLocale: 'en' }),
      defaultLocale: 'en',
      routeFacts: {
        patterns: [{ source: '^\\/users-([^/]+?)\\/?$', flags: 'i' }],
        named: { 'users-group': { requiredParams: ['group'] } }
      },
      assetExists: async () => false
    })

    expect(findings.map(finding => finding.message)).toEqual([
      'Broken internal link "/definitely-missing" (resolved to "/definitely-missing").'
    ])
  })

  test('recognizes configured quick links and reports missing configured route names', async () => {
    const page = document('/', [element('a', { href: '$main.pricing' }), element('a', { href: '$main.missing' })], 'index.md')
    const assetExists = vi.fn(async () => false)
    const findings = await validateContentLinks([page], {
      routes: [route(page, '/')],
      graph: buildContentGraph([page], { locales: ['en'], defaultLocale: 'en' }),
      links: {
        main: {
          pricing: { route: 'pricing' },
          missing: { route: 'missing-route' }
        }
      },
      routeFacts: {
        patterns: [{ source: '^\\/pricing\\/?$', flags: 'i' }],
        named: { pricing: { requiredParams: [] } }
      },
      assetExists
    })

    expect(assetExists).not.toHaveBeenCalled()
    expect(findings.map(finding => finding.message)).toEqual([
      'Configured quick link "$main.missing" references missing Nuxt route name "missing-route".'
    ])
  })

  test('requires configured quick-link route names and required parameters', async () => {
    const page = document('/', [
      element('a', { href: '$main.user' }),
      element('a', { href: '$main.unknown' }),
      element('a', { href: '$main.complete' })
    ], 'index.md')
    const findings = await validateContentLinks([page], {
      routes: [route(page, '/')],
      graph: buildContentGraph([page], { locales: ['en'], defaultLocale: 'en' }),
      links: {
        main: {
          user: { route: 'user' },
          unknown: { route: 'unknown' },
          complete: { route: 'user', params: { id: '42' } }
        }
      },
      routeFacts: {
        patterns: [],
        named: { user: { requiredParams: ['id'] } }
      },
      assetExists: async () => false
    })

    expect(findings.map(finding => finding.message)).toEqual([
      'Configured quick link "$main.unknown" references missing Nuxt route name "unknown".',
      'Configured quick link "$main.user" is missing required route parameter "id".'
    ])
  })

  test('passes decoded root-relative and colocated asset paths to source-aware validation', async () => {
    const page = document('/', [
      element('img', { src: '/images/hero%20wide.png' }),
      element('img', { src: './image%20one.png' })
    ], 'guide/index.md')
    const assetExists = vi.fn(async (_source: ParsedContent, value: string) =>
      value === '/images/hero wide.png' || value === './image one.png')

    const findings = await validateContentLinks([page], {
      routes: [route(page, '/')],
      graph: buildContentGraph([page], { locales: ['en'], defaultLocale: 'en' }),
      assetExists
    })

    expect(findings).toEqual([])
    expect(assetExists.mock.calls.map(([, value]) => value)).toEqual([
      '/images/hero wide.png',
      './image one.png'
    ])
  })

  test('preserves source provenance and turns malformed URLs into findings without aborting', async () => {
    const page = document('/', [
      element('img', { src: '../escape.png' }),
      element('img', { src: './image.png' }),
      element('a', { href: '/%' }),
      element('a', { href: '#%' }),
      element('a', { href: '/missing' })
    ], 'guide/index.md')
    const assetExists = vi.fn(async (source: ParsedContent, value: string) => source.file?.source === 'content' && value === './image.png')
    const findings = await validateContentLinks([page], {
      routes: [route(page, '/')],
      graph: buildContentGraph([page], { locales: ['en'], defaultLocale: 'en' }),
      assetExists
    })

    expect(assetExists).toHaveBeenCalledWith(page, '../escape.png')
    expect(findings.map(finding => finding.message)).toEqual(expect.arrayContaining([
      'Missing asset "../escape.png".',
      'Malformed internal reference "/%".',
      'Malformed internal reference "#%".',
      'Broken internal link "/missing" (resolved to "/missing").'
    ]))
  })

  test('reads only a valid report from the configured Nuxt build directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'ginko-validate-'))
    const reportDirectory = join(rootDir, '.custom-nuxt/content-cache')
    try {
      await writeFile(join(rootDir, 'nuxt.config.ts'), 'export default defineNuxtConfig({ buildDir: ".custom-nuxt" })')
      await mkdir(reportDirectory, { recursive: true })
      await writeFile(join(reportDirectory, 'validation.json'), JSON.stringify({ documents: [] }))
      await expect(runContentValidation({ rootDir })).resolves.toEqual(expect.objectContaining({ exitCode: 1 }))

      await writeFile(join(reportDirectory, 'validation.json'), JSON.stringify({
        version: 0, generatedAt: Date.now(), integrity: 'stale', findings: []
      }))
      await expect(runContentValidation({ rootDir })).resolves.toEqual(expect.objectContaining({ exitCode: 1 }))

      await writeFile(join(reportDirectory, 'validation.json'), JSON.stringify({
        version: 1, generatedAt: -1, integrity: '', findings: []
      }))
      await expect(runContentValidation({ rootDir })).resolves.toEqual(expect.objectContaining({ exitCode: 1 }))

      await writeFile(join(reportDirectory, 'validation.json'), JSON.stringify({
        version: 1, generatedAt: Date.now(), integrity: 'test', findings: []
      }))
      await expect(runContentValidation({ rootDir })).resolves.toEqual(expect.objectContaining({ findings: [], exitCode: 0 }))
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
