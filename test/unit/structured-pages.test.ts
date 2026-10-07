import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineCollection } from '../../packages/content/src/config'
import { assertResolvedContentContract, buildResolvedContentContract, hashCanonicalJson, type JsonValue } from '../../packages/content/src/cms-contract'
import { parsePortableDocument, portableDocumentPath, serializePortableDocument, validatePortableDocument, type PortableDocumentV1 } from '../../packages/content/src/portability'

const options = { defaultLocale: 'en', locales: ['en', 'de'] }
const build = () => buildResolvedContentContract({
  collections: {
    landing: defineCollection({
      type: 'page', body: false, i18n: true,
      route: { en: '/landing', de: '/seiten' },
      schema: z.object({ eyebrow: z.string(), destination: z.string().url() }),
    }),
  },
}, options)
const document = (): PortableDocumentV1 => ({
  format: 'ginko-content-document', version: 1, collection: 'landing',
  canonicalKey: 'home', locale: 'de', slug: 'start', parentCanonicalKey: null, order: null,
  shared: {}, localized: { title: 'Gemeinsam wachsen', description: 'Eine bessere Zukunft.', eyebrow: 'Willkommen', destination: 'https://example.test/de' },
  body: null, visibility: { navigation: true, search: true, sitemap: true },
})

describe('structured pages', () => {
  it('keeps page identity, locale routes and SEO fields without an article body', () => {
    const contract = build()
    expect(() => assertResolvedContentContract(contract)).not.toThrow()
    expect(contract.collections.landing).toMatchObject({
      kind: 'page', locales: ['en', 'de'],
      routing: { mode: 'route', localizedPathPrefixes: { en: '/landing', de: '/seiten' } },
      portable: { format: 'json', bodyField: null },
    })
    expect(contract.collections.landing!.fields.map(field => field.key)).toEqual(['title', 'description', 'eyebrow', 'destination'])
  })

  it('supports structured pages with the current V2 component-policy contract', () => {
    const contract = buildResolvedContentContract({ collections: { landing: { type: 'page', body: false } } }, {
      ...options, componentPolicy: { version: 2, components: {} },
    })
    expect(contract.version).toBe(2)
    expect(contract.collections.landing!.portable).toEqual({ format: 'json', bodyField: null })
    expect(() => assertResolvedContentContract(contract)).not.toThrow()
  })

  it('round trips route, visibility, localized fields and null body as portable JSON', async () => {
    const contract = build()
    const original = document()
    const path = portableDocumentPath(original, contract)
    expect(path).toMatch(/\.json$/)
    const serialized = await serializePortableDocument(original, contract)
    expect(await parsePortableDocument(serialized, contract, path)).toEqual(original)
    expect(await serializePortableDocument(await parsePortableDocument(serialized, contract, path), contract)).toBe(serialized)
  })

  it('rejects retained article content, invalid fields and missing route identity', async () => {
    const contract = build()
    expect(() => validatePortableDocument({ ...document(), body: { kind: 'mdc', source: 'Do not discard me' } }, contract)).toThrow()
    expect(() => validatePortableDocument({ ...document(), slug: '' }, contract)).toThrow()
    const invalid = document()
    invalid.localized.destination = 42
    await expect(serializePortableDocument(invalid, contract)).rejects.toThrow()
  })

  it('does not change existing article contracts or data collection semantics', async () => {
    const input = { collections: { article: { type: 'page' as const }, record: { type: 'data' as const } } }
    const contract = buildResolvedContentContract(input, options)
    expect(contract.collections.article!.portable).toEqual({ format: 'mdc', bodyField: 'bodyMdc' })
    expect(contract.collections.record!.routing.mode).toBe('none')
    expect(contract.collections.record!.fields).toEqual([])
    const explicitUndefined = buildResolvedContentContract({ collections: { article: { ...input.collections.article, body: undefined }, record: input.collections.record } }, options)
    expect(await hashCanonicalJson(contract as unknown as JsonValue)).toBe(await hashCanonicalJson(explicitUndefined as unknown as JsonValue))
    expect(() => buildResolvedContentContract({ collections: { record: { type: 'data', body: false } } }, options)).toThrow(/only when it is a page/)
  })

  it('rejects contradictory body declarations and malformed structured contracts', () => {
    expect(() => buildResolvedContentContract({ collections: { landing: { type: 'page', body: false, cms: { fields: { bodyMdc: { type: 'richtext' } } } } } }, options)).toThrow(/cannot declare an article body/)
    expect(() => buildResolvedContentContract({ collections: { landing: { type: 'page', body: false, schema: z.object({ body: z.string() }) } } }, options)).toThrow(/cannot declare an article body/)
    const malformed = build()
    malformed.collections.landing!.portable.format = 'yaml'
    expect(() => assertResolvedContentContract(malformed)).toThrow(/page portability policy/)
  })
})
