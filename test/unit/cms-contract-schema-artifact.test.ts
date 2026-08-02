import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { buildResolvedContentContract } from '../../packages/content/src/cms-contract'
import { fields } from '../../packages/content/src/config'

const options = { defaultLocale: 'en', locales: ['en', 'de'] }

describe('resolved content contract field normalization', () => {
  it('retains portable field semantics and drops CMS presentation metadata', () => {
    const contract = buildResolvedContentContract({
      collections: {
        authors: {
          type: 'data',
          source: 'content/authors/*.json',
        },
        records: {
          type: 'data',
          source: 'content/records/*.json',
          i18n: true,
          schema: z.object({
            headline: z.string().min(2).max(80),
            hero: fields.image({ aspectRatio: '16:9', accept: ['image/png', 'application/pdf'] }),
            author: fields.relation('authors').required(),
            links: fields.array(fields.object({ label: fields.text(), href: fields.url() })),
            status: fields.select(['draft', 'published']),
          }),
          cms: {
            fields: {
              headline: { defaultValue: null, label: { en: 'Title', de: 'Titel' }, editor: { width: 'half' } },
              divider: { type: 'divider', label: 'Presentation only' },
            },
          },
        },
      },
    }, options)

    const collection = contract.collections.records!
    const byKey = Object.fromEntries(collection.fields.map(field => [field.key, field]))
    expect(collection.portable).toEqual({ format: 'json', bodyField: null })
    expect(byKey.headline).toMatchObject({
      type: 'text', required: true, localized: true, default: { present: true, value: null },
      validation: { kind: 'string', minLength: 2, maxLength: 80, format: null },
    })
    expect(byKey.hero).toMatchObject({
      type: 'image', media: { mediaTypes: ['image/png'], aspectRatio: '16:9' },
    })
    expect(byKey.author).toMatchObject({
      type: 'relation', relation: { collection: 'authors', multiple: false },
    })
    expect(byKey.links).toMatchObject({ type: 'array', fields: expect.any(Array) })
    expect(byKey.status).toMatchObject({ type: 'select', options: ['draft', 'published'] })
    expect(byKey.divider).toBeUndefined()
    expect(JSON.stringify(contract)).not.toMatch(/Title|Titel|Presentation only|width/)
  })

  it('keeps localized route maps on the one contract artifact', () => {
    const contract = buildResolvedContentContract({
      collections: {
        home: {
          type: 'page',
          source: 'content/home.md',
          i18n: true,
          route: { en: '/', de: '/startseite' },
        },
      },
    }, options)

    expect(contract.collections.home?.routing).toMatchObject({
      pathPrefix: '/', singleton: true,
      localizedPathPrefixes: null,
      localizedSingletonPaths: { en: '/', de: '/startseite' },
    })
  })

  it('rejects invalid locale fallback graphs', () => {
    expect(() => buildResolvedContentContract({ collections: {} }, {
      ...options,
      localeFallbacks: { de: ['fr'] },
    })).toThrow(/undeclared locale/)
    expect(() => buildResolvedContentContract({ collections: {} }, {
      ...options,
      localeFallbacks: { en: ['de'], de: ['en'] },
    })).toThrow(/cycle/)
  })

  it('normalizes date defaults and rejects non-JSON explicit defaults at the contract boundary', () => {
    const contract = buildResolvedContentContract({
      collections: {
        records: {
          type: 'data',
          cms: { fields: { publishedAt: { defaultValue: new Date(0) } } },
        },
      },
    }, options)
    expect(contract.collections.records?.fields).toContainEqual(expect.objectContaining({
      key: 'publishedAt',
      default: { present: true, value: '1970-01-01T00:00:00.000Z' },
    }))
    expect(() => buildResolvedContentContract({
      collections: {
        records: {
          type: 'data',
          cms: { fields: { invalid: { defaultValue: new Map() } } },
        },
      },
    }, options)).toThrow(/non-JSON-serializable/)
  })

  it('rejects field policy that is irrelevant to its field type', () => {
    expect(() => buildResolvedContentContract({
      collections: {
        records: {
          type: 'data',
          cms: { fields: { title: { type: 'text', options: ['invalid'] } } },
        },
      },
    }, options)).toThrow(/options for type "text"/)
  })
})
