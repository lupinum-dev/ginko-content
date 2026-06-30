import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import {
  createCmsExchangeImportPlan,
  readCmsExchangeFilesFromDirectory,
  renderCmsExchangeFile,
  renderCmsExchangeManifest,
  resolveCmsExportPath,
  type CmsImportContentContext,
} from '../../packages/content/src/cms-exchange'
import type { CmsContract } from '../../packages/content/src/cms-contract'

const context: CmsImportContentContext = {
  locales: ['en', 'de'],
  defaultLocale: 'en',
  translatedSlugs: true,
  respectPathCase: false,
  markdown: {
    plugins: [],
    tags: {},
    anchorLinks: {
      depth: 4,
      exclude: [1],
    },
    image: 'auto',
  },
  yaml: {},
  csv: { delimiter: ',', json: true },
  collections: {
    pages: {
      type: 'page',
      source: ['*/pages/**/*.md', '*/pages/**/*.mdc'],
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: '/',
      cms: { type: 'tree', route: { rootSlug: 'home' } },
    },
    settings: {
      type: 'data',
      source: 'settings/*.yml',
    },
    articles: {
      slug: 'articles',
      label: 'Articles',
      type: 'flat',
      locales: ['en', 'de'],
      defaultLocale: 'en',
      routing: {
        mode: 'route',
        pathPrefix: '/articles',
        slugMode: 'stable',
        rootSlug: null,
        singleton: false,
      },
      fields: [
        {
          key: 'title',
          type: 'text',
          role: 'title',
          label: 'Title',
          required: true,
          localized: true,
          hidden: false,
          searchable: true,
          sortable: true,
          order: 0,
          width: 'full',
        },
        {
          key: 'bodyMdc',
          type: 'richtext',
          role: 'body',
          label: 'Body',
          required: false,
          localized: true,
          hidden: false,
          searchable: true,
          sortable: false,
          order: 1,
          width: 'full',
        },
      ],
    },
  },
}

const contract: CmsContract = {
  contractVersion: 'test',
  defaultLocale: 'en',
  locales: ['en', 'de'],
  collections: {
    pages: {
      slug: 'pages',
      label: 'Pages',
      type: 'tree',
      locales: ['en', 'de'],
      defaultLocale: 'en',
      routing: {
        mode: 'route',
        pathPrefix: '',
        slugMode: 'stable',
        rootSlug: 'home',
        singleton: false,
      },
      fields: [
        {
          key: 'title',
          type: 'text',
          role: 'title',
          label: 'Title',
          required: true,
          localized: true,
          hidden: false,
          searchable: true,
          sortable: true,
          order: 0,
          width: 'full',
        },
        {
          key: 'description',
          type: 'textarea',
          role: 'description',
          label: 'Description',
          required: false,
          localized: true,
          hidden: false,
          searchable: true,
          sortable: false,
          order: 1,
          width: 'full',
        },
        {
          key: 'bodyMdc',
          type: 'richtext',
          role: 'body',
          label: 'Body',
          required: false,
          localized: true,
          hidden: false,
          searchable: true,
          sortable: false,
          order: 2,
          width: 'full',
        },
      ],
    },
  },
}

const files = [
  {
    id: 'content:en/pages/1.home.md',
    sourcePath: 'content/en/pages/1.home.md',
    source: [
      '---',
      'title: Home',
      'description: Welcome home',
      'ref: page-home',
      '---',
      '',
      '# Home',
      '',
      '![Hero](../assets/hero.jpg)',
    ].join('\n'),
  },
  {
    id: 'content:en/pages/2.about.md',
    sourcePath: 'content/en/pages/2.about.md',
    source: [
      '---',
      'title: About',
      'description: About us',
      'ref: page-about',
      '---',
      '',
      '# About',
    ].join('\n'),
  },
  {
    id: 'content:en/pages/2.about/1.team.mdc',
    sourcePath: 'content/en/pages/2.about/1.team.mdc',
    source: [
      '---',
      'title: Team',
      'ref: page-team',
      '---',
      '',
      '# Team',
      '',
      '::callout',
      'People behind the work.',
      '::',
    ].join('\n'),
  },
  {
    id: 'content:settings/site.yml',
    sourcePath: 'content/settings/site.yml',
    source: 'title: Site settings',
  },
]

describe('cms-exchange', () => {
  test('reads exchange files from a directory in deterministic source path order', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'ginko-cms-exchange-'))
    try {
      await mkdir(join(rootDir, 'pages', 'nested'), { recursive: true })
      await writeFile(join(rootDir, 'pages', 'z.md'), '# Z')
      await writeFile(join(rootDir, 'pages', 'nested', 'a.mdc'), '# A')
      await writeFile(join(rootDir, 'pages', 'ignored.txt'), 'ignored')
      await writeFile(join(rootDir, 'ginko-cms-export.json'), '{"version":1}')

      const scanned = await readCmsExchangeFilesFromDirectory({ rootDir })

      expect(scanned).toEqual([
        {
          id: 'content:pages/nested/a.mdc',
          sourcePath: 'pages/nested/a.mdc',
          source: '# A',
        },
        {
          id: 'content:pages/z.md',
          sourcePath: 'pages/z.md',
          source: '# Z',
        },
      ])
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test('plans route-backed Markdown/MDC exchange files and renders them deterministically', async () => {
    const plan = await createCmsExchangeImportPlan({
      files,
      context,
      contract,
      generatedAt: '2026-06-29T12:00:00.000Z',
      contractChecksum: 'sha256:test',
    })

    expect(plan.documents.map(document => document.stableId)).toEqual([
      'page-home',
      'page-about',
      'page-team',
    ])
    expect(plan.documents[2]).toMatchObject({
      sourcePath: 'content/en/pages/2.about/1.team.mdc',
      sourceChecksum: expect.stringMatching(/^fnv1a32:[a-f0-9]{8}$/),
      extension: 'mdc',
      parentStableId: 'page-about',
      sortOrder: 1,
      values: {
        title: 'Team',
      },
    })
    expect(plan.assets).toEqual([
      {
        sourcePath: '../assets/hero.jpg',
        referencedBy: ['content/en/pages/1.home.md'],
      },
    ])
    expect(plan.warnings).toEqual([
      expect.objectContaining({
        code: 'unsupported_collection',
        sourcePath: 'content/settings/site.yml',
      }),
    ])

    const rendered = plan.documents.map(document =>
      renderCmsExchangeFile({
        document,
        contract,
        exportedAt: '2026-06-29T12:00:00.000Z',
        source: 'ginko-cms2',
      }),
    )
    expect(rendered[0].path).toBe('content/en/pages/1.home.md')
    expect(rendered[0].text).toContain('ref: page-home')
    expect(rendered[0].text).toContain('sortOrder: 1')
    expect(rendered[0].text).toContain('![Hero](../assets/hero.jpg)')
    expect(rendered[2].contentType).toBe('text/mdc; charset=utf-8')

    const manifest = renderCmsExchangeManifest({
      files: rendered,
      documents: plan.documents,
      assets: plan.assets,
      warnings: plan.warnings,
      generatedAt: '2026-06-29T12:00:00.000Z',
      contractChecksum: 'sha256:test',
      generator: 'test',
    })
    const manifestJson = JSON.parse(manifest.text)
    expect(manifestJson).toMatchObject({
      version: 1,
      contractChecksum: 'sha256:test',
      documents: expect.arrayContaining([
        expect.objectContaining({
          stableId: 'page-home',
          checksum: rendered[0].checksum,
        }),
      ]),
      assets: plan.assets,
    })
    expect(manifestJson.warnings).toEqual([
      expect.objectContaining({
        code: 'unsupported_collection',
        sourcePath: 'content/settings/site.yml',
      }),
      {
        code: 'asset_not_bundled',
        message: 'Asset "../assets/hero.jpg" is referenced but is not bundled by this exchange artifact.',
        sourcePath: '../assets/hero.jpg',
      },
    ])

    const roundtripPlan = await createCmsExchangeImportPlan({
      files: rendered.map(file => ({
        id: `content:${file.path.replace(/^content\//, '')}`,
        sourcePath: file.path,
        source: file.text,
      })),
      context,
      contract,
      generatedAt: '2026-06-29T12:00:00.000Z',
      contractChecksum: 'sha256:test',
    })
    const rerendered = roundtripPlan.documents.map(document =>
      renderCmsExchangeFile({
        document,
        contract,
        exportedAt: '2026-06-29T12:00:00.000Z',
        source: 'ginko-cms2',
      }),
    )

    expect(rerendered.map(file => file.text)).toEqual(rendered.map(file => file.text))
  })

  test('resolves importable fallback export paths when source metadata is absent', () => {
    expect(resolveCmsExportPath({
      stableId: 'page-home',
      collection: 'pages',
      locale: 'en',
      path: '/',
      extension: 'md',
      frontmatter: {},
      values: { title: 'Home' },
    }, contract)).toBe('pages/index.md')

    expect(resolveCmsExportPath({
      stableId: 'page-home',
      collection: 'pages',
      locale: 'de',
      path: '/',
      extension: 'md',
      frontmatter: {},
      values: { title: 'Start' },
    }, contract)).toBe('de/pages/index.md')

    expect(resolveCmsExportPath({
      stableId: 'article-release',
      collection: 'articles',
      locale: 'en',
      path: '/articles/release-notes',
      extension: 'mdc',
      frontmatter: {},
      values: { title: 'Release notes' },
    }, contract)).toBe('articles/release-notes.mdc')
  })

  test('falls back to deterministic export paths when source metadata is unsafe', () => {
    const unsafeSourcePaths = [
      '../outside.md',
      'content/../outside.md',
      'content//outside.md',
      './content/outside.md',
      'content/./outside.md',
      '/absolute/outside.md',
      'C:/absolute/outside.md',
      'ginko-cms-export.json',
      'content/ginko-cms-export.json',
      'content/readme.txt',
    ]

    for (const sourcePath of unsafeSourcePaths) {
      expect(resolveCmsExportPath({
        stableId: 'page-about',
        collection: 'pages',
        locale: 'en',
        path: '/about',
        sourcePath,
        extension: 'md',
        frontmatter: {},
        values: { title: 'About' },
      }, contract), sourcePath).toBe('pages/about.md')
    }

    expect(resolveCmsExportPath({
      stableId: 'page-about',
      collection: 'pages',
      locale: 'en',
      path: '/about',
      sourcePath: 'content/en/pages/about.md',
      extension: 'md',
      frontmatter: {},
      values: { title: 'About' },
    }, contract)).toBe('content/en/pages/about.md')
  })

  test('preserves external asset URLs without treating them as unbundled local assets', async () => {
    const plan = await createCmsExchangeImportPlan({
      files: [
        {
          id: 'content:en/pages/remote-assets.md',
          sourcePath: 'content/en/pages/remote-assets.md',
          source: [
            '---',
            'title: Remote assets',
            'description: https://cdn.example.com/hero.jpg',
            'ref: page-remote-assets',
            '---',
            '',
            '# Remote assets',
            '',
            '![Remote hero](https://cdn.example.com/hero.jpg)',
            '',
            '<img src="https://cdn.example.com/inline.jpg">',
          ].join('\n'),
        },
      ],
      context,
      contract,
      generatedAt: '2026-06-29T12:00:00.000Z',
      contractChecksum: 'sha256:test',
    })

    expect(plan.assets).toEqual([])
    expect(plan.warnings).toEqual([])

    const rendered = renderCmsExchangeFile({
      document: plan.documents[0],
      contract,
      exportedAt: '2026-06-29T12:00:00.000Z',
      source: 'ginko-cms2',
    })
    expect(rendered.text).toContain('description: https://cdn.example.com/hero.jpg')
    expect(rendered.text).toContain('![Remote hero](https://cdn.example.com/hero.jpg)')
    expect(rendered.text).toContain('<img src="https://cdn.example.com/inline.jpg">')

    const manifest = renderCmsExchangeManifest({
      files: [rendered],
      documents: plan.documents,
      assets: plan.assets,
      warnings: plan.warnings,
      generatedAt: '2026-06-29T12:00:00.000Z',
      contractChecksum: 'sha256:test',
      generator: 'test',
    })
    expect(JSON.parse(manifest.text).warnings).toEqual([])
  })
})
