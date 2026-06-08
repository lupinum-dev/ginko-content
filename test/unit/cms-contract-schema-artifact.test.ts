import { describe, expect, it } from 'vitest'
import { z, type ZodType } from 'zod'

import {
  CmsContractSchemaUnsupportedError,
  buildCmsContract,
} from '../../packages/content/src/cms-contract/build'
import { fields } from '../../packages/content/src/config'
import type { BuildCmsContractInput } from '../../packages/content/src/cms-contract'

const options = {
  defaultLocale: 'en',
  locales: ['en', 'de'],
}

function configFor(schema: ZodType): BuildCmsContractInput {
  return {
    collections: {
      posts: {
        source: 'content/posts/**/*.md',
        schema,
      },
    },
  }
}

function build(schema: ZodType) {
  return buildCmsContract(configFor(schema), options)
}

function expectUnsupported(schema: ZodType, feature: string) {
  expect(() => build(schema)).toThrow(CmsContractSchemaUnsupportedError)
  expect(() => build(schema)).toThrow(feature)
}

describe('CMS schema artifact guard', () => {
  it('keeps localized route maps in the CMS contract', () => {
    const contract = buildCmsContract(
      {
        collections: {
          docs: {
            type: 'page',
            source: 'content/docs/**/*.md',
            i18n: true,
            route: { en: '/docs', de: '/dokumentation' },
            cms: { type: 'tree' },
          },
          home: {
            type: 'page',
            source: 'content/home.md',
            i18n: true,
            route: { en: '/', de: '/startseite' },
            cms: { route: { singleton: true } },
          },
        },
      },
      options,
    )

    expect(contract.collections.docs?.routing).toMatchObject({
      pathPrefix: '/docs',
      localizedPathPrefixes: {
        en: '/docs',
        de: '/dokumentation',
      },
    })
    expect(contract.collections.home?.routing).toMatchObject({
      pathPrefix: '/',
      singleton: true,
      localizedSingletonPaths: {
        en: '/',
        de: '/startseite',
      },
    })
  })

  it('treats single-file route collections as singleton pages', () => {
    const contract = buildCmsContract(
      {
        collections: {
          pricing: {
            type: 'page',
            source: '2.pricing.yml',
            i18n: true,
            route: { en: '/pricing', de: '/preise' },
          },
          posts: {
            type: 'page',
            source: '3.blog/**/*',
            i18n: true,
            route: '/blog',
          },
        },
      },
      options,
    )

    expect(contract.collections.pricing?.routing).toMatchObject({
      pathPrefix: '/pricing',
      singleton: true,
      localizedSingletonPaths: {
        en: '/pricing',
        de: '/preise',
      },
    })
    expect(contract.collections.posts?.routing).toMatchObject({
      pathPrefix: '/blog',
      singleton: false,
    })
  })

  it('serializes capabilities for supported schemas', () => {
    const contract = build(
      z.object({
        title: z.string().min(1),
        summary: z.string().email().optional(),
        tags: z.array(z.string()),
        count: z.number().default(0),
        featured: z.boolean().nullable(),
        publishedAt: z.date(),
        status: z.enum(['draft', 'published']),
      }),
    )

    expect(contract.collections.posts?.schema).toMatchObject({
      artifactId: 'cms-schema:posts:v1',
      capabilities: {
        unsupported: [],
      },
    })
    expect(contract.collections.posts?.schema?.checksum).toMatch(/^fnv1a32:[0-9a-f]{8}$/)
    expect(JSON.parse(contract.collections.posts?.schema?.artifact ?? '{}')).toMatchObject({
      version: 'v1',
      root: {
        kind: 'object',
      },
    })
    expect(contract.collections.posts?.schema?.capabilities.supports).toEqual(
      expect.arrayContaining([
        'array',
        'boolean',
        'date',
        'default',
        'enum',
        'nullable',
        'number',
        'object',
        'optional',
        'string',
      ]),
    )
  })

  it('preserves public CMS field metadata in the generated contract', () => {
    const contract = buildCmsContract(
      {
        collections: {
          posts: {
            type: 'data',
            source: 'content/posts/*.json',
            i18n: true,
            schema: z.object({
              headline: fields.text().required().label({ en: 'Title', de: 'Titel' }).localized(),
              copy: fields.richtext(),
              hero: fields.image({ aspectRatio: '16:9', accept: ['image/png'] }),
              attachment: fields.asset({ accept: ['application/pdf'] }),
              author: fields.relation('authors').required(),
              related: fields.relations('posts'),
              settings: fields.object({
                summary: fields.text(),
                pinned: fields.boolean(),
              }),
              links: fields.array(fields.object({
                label: fields.text(),
                href: fields.url(),
              })),
              status: fields.select(['draft', 'published']),
              score: fields.number(),
              featured: fields.boolean(),
              publishDate: fields.date(),
              slug: fields.slug({ from: 'title' }),
            }),
          },
        },
      },
      options,
    )

    const byKey = Object.fromEntries(
      (contract.collections.posts?.fields ?? []).map(field => [field.key, field]),
    )

    expect(byKey.headline).toMatchObject({
      type: 'text',
      required: true,
      localized: true,
      label: { en: 'Title', de: 'Titel' },
    })
    expect(byKey.copy).toMatchObject({ type: 'richtext', localized: true })
    expect(byKey.hero).toMatchObject({
      type: 'image',
      localized: false,
      media: { accept: ['image/png'], aspectRatio: '16:9' },
    })
    expect(byKey.attachment).toMatchObject({
      type: 'file',
      localized: false,
      media: { accept: ['application/pdf'], aspectRatio: null },
    })
    expect(byKey.author).toMatchObject({
      type: 'relation',
      required: true,
      relation: { collectionId: 'authors', multiple: false },
    })
    expect(byKey.related).toMatchObject({
      type: 'relations',
      relation: { collectionId: 'posts', multiple: true },
    })
    expect(byKey.settings).toMatchObject({
      type: 'object',
      localized: true,
      fields: expect.arrayContaining([
        expect.objectContaining({ key: 'pinned', type: 'toggle', localized: false }),
        expect.objectContaining({ key: 'summary', type: 'text', localized: false }),
      ]),
    })
    expect(byKey.links).toMatchObject({
      type: 'array',
      localized: true,
      fields: expect.arrayContaining([
        expect.objectContaining({ key: 'href', type: 'url' }),
        expect.objectContaining({ key: 'label', type: 'text' }),
      ]),
    })
    expect(byKey.status).toMatchObject({ type: 'select', options: ['draft', 'published'] })
    expect(byKey.score).toMatchObject({ type: 'number', localized: false })
    expect(byKey.featured).toMatchObject({ type: 'toggle', localized: false })
    expect(byKey.publishDate).toMatchObject({ type: 'date', localized: false })
    expect(byKey.slug).toMatchObject({ type: 'slug', slugFrom: 'title' })
  })

  it('emits CMS array fields only for object arrays', () => {
    const contract = build(
      z.object({
        links: z.array(
          z.object({
            label: z.string(),
            to: z.string(),
          }),
        ),
        tags: z.array(z.string()),
      }),
    )

    expect(contract.collections.posts?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'links',
          type: 'array',
          fields: expect.arrayContaining([
            expect.objectContaining({ key: 'label', type: 'text' }),
            expect.objectContaining({ key: 'to', type: 'text' }),
          ]),
        }),
        expect.objectContaining({
          key: 'tags',
          type: 'json',
          fields: null,
        }),
      ]),
    )
  })

  it('emits stable artifact bytes and checksum for the same schema', () => {
    const schema = z.object({
      title: z.string().min(1),
      tags: z.array(z.string()),
      status: z.enum(['draft', 'published']),
    })

    const first = build(schema).collections.posts?.schema
    const second = build(schema).collections.posts?.schema

    expect(first?.checksum).toBe(second?.checksum)
    expect(first?.artifact).toBe(second?.artifact)
    expect(JSON.parse(first?.artifact ?? '{}').root).toMatchObject({
      kind: 'object',
      required: ['status', 'tags', 'title'],
      shape: {
        status: { kind: 'enum', values: ['draft', 'published'] },
        tags: { kind: 'array', element: { kind: 'string' } },
        title: { kind: 'string', checks: [{ kind: 'min', value: 1 }] },
      },
    })
  })

  it('serializes built-in string validation checks without a second parser', () => {
    const schema = build(
      z.object({
        email: z.string().email(),
        website: z.string().url(),
      }),
    ).collections.posts?.schema

    expect(JSON.parse(schema?.artifact ?? '{}').root).toMatchObject({
      kind: 'object',
      shape: {
        email: { kind: 'string', checks: [{ kind: 'email' }] },
        website: { kind: 'string', checks: [{ kind: 'url' }] },
      },
    })
  })

  it('fails contract build for transform schemas', () => {
    expectUnsupported(
      z.object({
        title: z.string().transform((value) => value.trim()),
      }),
      'ZodEffects',
    )
  })

  it('fails contract build for pipe schemas', () => {
    expectUnsupported(
      z.object({
        title: z.string().pipe(z.string().min(1)),
      }),
      'ZodEffects',
    )
  })

  it('fails contract build for custom refine schemas', () => {
    expectUnsupported(
      z.object({
        title: z.string().refine((value) => value.length > 3),
      }),
      'ZodRefinement',
    )
  })

  it('fails contract build for async refine schemas', () => {
    expectUnsupported(
      z.object({
        title: z.string().refine(async (value) => value.length > 3),
      }),
      'ZodAsyncRefinement',
    )
  })

  it('fails contract build for branded schemas when the runtime exposes the brand wrapper', () => {
    const branded = {
      _def: {
        type: 'branded',
        innerType: z.string(),
      },
    } as unknown as ZodType

    expectUnsupported(
      z.object({
        title: branded,
      }),
      'ZodBranded',
    )
  })

  it('fails contract build for catch schemas', () => {
    expectUnsupported(
      z.object({
        title: z.string().catch('Untitled'),
      }),
      'ZodCatch',
    )
  })
})
