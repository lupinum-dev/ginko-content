import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ResolvedContentContractV1, ResolvedContentFieldV1 } from '../../packages/content/src/cms-contract'
import {
  classifyPortableMdc,
  collectPortableMdcAssetReferences,
  decodePortableIdentitySegment,
  encodePortableIdentitySegment,
  normalizePortableModel,
  parsePortableDocument,
  parsePortableManifest,
  portableDocumentPath,
  rebuildPortableManifest,
  rewritePortableMdcAssetReferences,
  rewritePortableMdcAssetReferencesForStorage,
  rewriteStoredMdcAssetReferences,
  serializePortableDocument,
  serializePortableManifest,
  validatePortableReferences,
} from '../../packages/content/src/portability'
import { PORTABILITY_CONTRACT_FIXTURES, runPortabilityContract } from '../../packages/content/src/testing/portability-contract'
import { parsePortableJson } from '../../packages/content/src/portability/json'

const absent = { present: false } as const
const field = (key: string, type: ResolvedContentFieldV1['type'], localized: boolean, extra: Partial<ResolvedContentFieldV1> = {}): ResolvedContentFieldV1 => ({
  key,
  type,
  role: null,
  required: false,
  localized,
  searchable: false,
  sortable: false,
  default: absent,
  options: null,
  relation: null,
  media: null,
  fields: null,
  validation: null,
  min: null,
  max: null,
  step: null,
  slugFrom: null,
  language: null,
  ...extra,
})

const routing = {
  mode: 'route' as const,
  pathPrefix: '',
  localizedPathPrefixes: null,
  localizedSingletonPaths: null,
  slugMode: 'localized' as const,
  rootSlug: null,
  singleton: false,
  allowMultipleRoots: true,
}

const contract: ResolvedContentContractV1 = {
  format: 'ginko-content-contract',
  version: 1,
  defaultLocale: 'en',
  locales: ['en', 'de'],
  localeFallbacks: { en: [], de: ['en'] },
  collections: {
    docs: {
      id: 'docs', kind: 'page', structure: 'tree', defaultLocale: 'en', locales: ['en', 'de'], routing,
      fields: [
        field('title', 'text', true, { role: 'title', required: true }),
        field('related', 'relation', false, { relation: { collection: 'authors', multiple: false } }),
        field('hero', 'image', false, { media: { mediaTypes: ['image/png'], aspectRatio: null } }),
        field('body', 'richtext', true, { role: 'body' }),
      ],
      portable: { format: 'mdc', bodyField: 'body' },
      componentPolicy: {
        components: {
          callout: { kind: 'block', props: { tone: { type: 'string', required: true } }, slots: ['default'], media: null },
          media: {
            kind: 'block',
            props: { src: { type: 'asset', required: true } },
            slots: [],
            media: { sourceProp: 'src', altProp: null, titleProp: null, filenameProp: null },
          },
        },
      },
    },
    authors: {
      id: 'authors', kind: 'data', structure: 'flat', defaultLocale: 'en', locales: ['en'],
      routing: { ...routing, mode: 'none', slugMode: 'shared' },
      fields: [
        field('name', 'text', false, { required: true }),
        field('biography', 'textarea', false),
        field('summary', 'richtext', false),
        field('handle', 'slug', false),
        field('email', 'email', false),
        field('website', 'url', false),
        field('aliases', 'multiselect', false, { options: ['Augusta Ada King'] }),
        field('active', 'toggle', false),
        field('agreed', 'checkbox', false),
        field('score', 'number', false),
        field('rating', 'range', false),
        field('role', 'select', false, { options: ['author'] }),
        field('status', 'radio', false, { options: ['active'] }),
        field('born', 'date', false),
        field('updated', 'datetime', false),
        field('wakeTime', 'time', false),
        field('metadata', 'json', false),
        field('profile', 'object', false, { fields: [field('city', 'text', false), field('rank', 'number', false)] }),
        field('rows', 'array', false, { fields: [field('label', 'text', false)] }),
        field('blocks', 'blocks', false, { fields: [field('label', 'text', false)] }),
        field('mentor', 'relation', false, { relation: { collection: 'authors', multiple: false } }),
        field('friends', 'relations', false, { relation: { collection: 'authors', multiple: true } }),
        field('portrait', 'image', false, { media: { mediaTypes: ['image/png'], aspectRatio: null } }),
        field('gallery', 'images', false, { media: { mediaTypes: ['image/png'], aspectRatio: null } }),
        field('attachment', 'file', false, { media: { mediaTypes: ['image/png'], aspectRatio: null } }),
        field('icon', 'icon', false),
        field('snippet', 'code', false),
        field('accent', 'color', false),
      ],
      portable: { format: 'yaml', bodyField: null }, componentPolicy: { components: {} },
    },
    news: {
      id: 'news', kind: 'page', structure: 'flat', defaultLocale: 'en', locales: ['en'], routing,
      fields: [field('title', 'text', true, { role: 'title', required: true }), field('body', 'richtext', true, { role: 'body' })],
      portable: { format: 'mdc', bodyField: 'body' }, componentPolicy: { components: {} },
    },
  },
}

const fixture = (...segments: string[]) => resolve('packages/content/test/fixtures/portability', ...segments)

it('parses own __proto__ JSON keys as data without changing object prototypes', () => {
  const parsed = parsePortableJson('{"__proto__":{"source":"portable"},"title":"Safe"}') as Record<string, unknown>

  expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
  expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
  expect(parsed.__proto__).toEqual({ source: 'portable' })
  expect(parsed.title).toBe('Safe')
})

describe('portable content contract', () => {
  it('passes the observable Level-1 codec contract', async () => {
    await expect(runPortabilityContract()).resolves.toEqual({ checks: 9 })
  })

  it('parses and canonically serializes a materialized multilingual document', async () => {
    const source = await readFile(fixture('content/docs/docs.introduction/en.md'), 'utf8')
    const document = await parsePortableDocument(source, contract, 'content/moved.md')
    expect(document.canonicalKey).toBe('docs.introduction')
    expect(document.shared.related).toEqual({ collection: 'authors', canonicalKey: 'author.ada' })
    expect(document.localized.title).toBe('Introduction')
    expect(portableDocumentPath(document, contract)).toBe('content/docs/docs.introduction/en.md')
    expect(await parsePortableDocument(await serializePortableDocument(document, contract), contract)).toEqual(document)
  })

  it('uses reversible NFC-safe identity path segments', () => {
    expect(encodePortableIdentitySegment('café %')).toBe('caf%C3%A9%20%25')
    expect(decodePortableIdentitySegment('caf%C3%A9%20%25')).toBe('café %')
    expect(() => encodePortableIdentitySegment('e\u0301')).toThrowError(expect.objectContaining({ code: 'PATH_INVALID' }))
    expect(() => decodePortableIdentitySegment('%2f')).toThrowError(expect.objectContaining({ code: 'PATH_INVALID' }))
  })

  it('rejects misplaced fields, topology violations, and missing references', async () => {
    const source = await readFile(fixture('content/docs/docs.child/en.md'), 'utf8')
    const child = await parsePortableDocument(source, contract)
    expect(() => validatePortableReferences([child], contract)).toThrowError(expect.objectContaining({ code: 'REFERENCE_MISSING' }))
    await expect(parsePortableDocument(source.replace('order: "0000000000020000"', 'order: "2"'), contract)).rejects.toMatchObject({ code: 'DOCUMENT_INVALID' })
    await expect(parsePortableDocument(source.replace('title: Child', 'unknown: true\ntitle: Child'), contract)).rejects.toMatchObject({ code: 'DOCUMENT_INVALID' })
  })

  it('classifies portable MDC semantically and rejects active syntax', async () => {
    await expect(classifyPortableMdc('::callout{tone="info"}\nSafe\n::', contract.collections.docs.componentPolicy)).resolves.toMatchObject({ classification: 'portable' })
    await expect(classifyPortableMdc('> [!NOTE]\n> Safe', contract.collections.docs.componentPolicy)).resolves.toMatchObject({
      classification: 'portable',
      ast: { nodes: [['blockquote', { 'data-alert': 'note' }, 'Safe']] },
    })
    await expect(classifyPortableMdc('::blockquote{as="dialog"}\nUnsafe\n::', contract.collections.docs.componentPolicy)).resolves.toMatchObject({ classification: 'rejected' })
    await expect(classifyPortableMdc('[Unsafe]{style="display:none"}', contract.collections.docs.componentPolicy)).resolves.toMatchObject({ classification: 'rejected' })
    await expect(classifyPortableMdc('<script>alert(1)</script>', contract.collections.docs.componentPolicy)).resolves.toMatchObject({ classification: 'rejected', issues: [{ code: 'MDC_UNSUPPORTED' }] })
  })

  it('collects and rewrites only structural Markdown and MDC asset sources', async () => {
    const sha256 = PORTABILITY_CONTRACT_FIXTURES.png.sha256
    const local = `/ginko-assets/${sha256}.png`
    const source = [
      `![Hero](${local})`,
      '',
      `::media{src="${local}"}`,
      '::',
      '',
      `\`${local}\` remains authored text.`,
      '',
      '![External](https://images.example.test/external.png)',
    ].join('\n')

    await expect(
      collectPortableMdcAssetReferences(source, contract.collections.docs.componentPolicy),
    ).resolves.toEqual([
      { path: local, sha256, mediaType: 'image/png' },
      { path: local, sha256, mediaType: 'image/png' },
    ])

    const rewritten = await rewritePortableMdcAssetReferences(
      source,
      contract.collections.docs.componentPolicy,
      (reference) => `https://assets.example.test/${reference.sha256}.png`,
    )
    expect(rewritten).toContain(`![Hero](https://assets.example.test/${sha256}.png)`)
    expect(rewritten).toContain(`::media{src="https://assets.example.test/${sha256}.png"}`)
    expect(rewritten).toContain(`\`${local}\` remains authored text.`)
    expect(rewritten).toContain('![External](https://images.example.test/external.png)')

    const stored = await rewritePortableMdcAssetReferencesForStorage(
      source,
      contract.collections.docs.componentPolicy,
      () => 'opaqueassetid1234567890',
    )
    expect(stored).toContain('![Hero](opaqueassetid1234567890)')
    expect(stored).toContain('::media{src="opaqueassetid1234567890"}')
    expect(stored).toContain(`\`${local}\` remains authored text.`)
    const roundTrip = await rewriteStoredMdcAssetReferences(
      stored,
      contract.collections.docs.componentPolicy,
      async () => local,
    )
    expect(roundTrip).toContain(`![Hero](${local})`)
    expect(roundTrip).toContain(`::media{src="${local}"}`)
    await expect(
      rewritePortableMdcAssetReferencesForStorage(
        source,
        contract.collections.docs.componentPolicy,
        () => 'javascript:alert(1)',
      ),
    ).rejects.toMatchObject({ code: 'ASSET_INTEGRITY_FAILED' })
  })

  it('normalizes ordering without deriving identity from paths', async () => {
    const sources = await Promise.all([
      'content/docs/docs.introduction/de.md',
      'content/docs/docs.introduction/en.md',
    ].map(async file => parsePortableDocument(await readFile(fixture(file), 'utf8'), contract, file)))
    expect(normalizePortableModel({ documents: sources, assets: [] }).documents.map(document => document.locale)).toEqual(['de', 'en'])
  })

  it('freezes tree, flat, and all supported data-field mappings', async () => {
    const files = [
      'content/docs/docs.introduction/en.md',
      'content/docs/docs.introduction/de.md',
      'content/docs/docs.child/en.md',
      'content/news/news.launch/en.md',
      'content/authors/author.ada/en.yml',
    ]
    const documents = await Promise.all(files.map(async file => parsePortableDocument(await readFile(fixture(file), 'utf8'), contract, file)))
    expect(() => validatePortableReferences(documents, contract)).not.toThrow()
    expect(documents.at(-1)?.shared).toMatchObject({
      metadata: { nested: true },
      profile: { city: 'London', rank: 1 },
      mentor: { collection: 'authors', canonicalKey: 'author.ada' },
      portrait: { sha256: '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460' },
    })
  })

  it('rebuilds a byte-identical manifest and verifies one deduplicated asset blob', async () => {
    const files = [
      'content/docs/docs.introduction/en.md',
      'content/docs/docs.introduction/de.md',
      'content/docs/docs.child/en.md',
      'content/news/news.launch/en.md',
      'content/authors/author.ada/en.yml',
    ]
    const documents = await Promise.all(files.map(async file => {
      const document = await parsePortableDocument(await readFile(fixture(file), 'utf8'), contract, file)
      return { file, document, bytes: new TextEncoder().encode(await serializePortableDocument(document, contract)) }
    }))
    const sha256 = PORTABILITY_CONTRACT_FIXTURES.png.sha256
    const manifest = await rebuildPortableManifest({
      contract,
      documents,
      assets: [{ sha256, file: `public/ginko-assets/${sha256}.png`, bytes: 68, mediaType: 'image/png', content: PORTABILITY_CONTRACT_FIXTURES.png.bytes }],
    })
    const bytes = serializePortableManifest(manifest)
    expect(serializePortableManifest(parsePortableManifest(bytes))).toEqual(bytes)
    await expect(rebuildPortableManifest({
      contract,
      documents,
      assets: [{ sha256, file: `public/ginko-assets/${sha256}.png`, bytes: 67, mediaType: 'image/png', content: PORTABILITY_CONTRACT_FIXTURES.png.bytes }],
    })).rejects.toMatchObject({ code: 'ASSET_INTEGRITY_FAILED' })
  })

  it('rejects duplicate YAML/JSON keys and secret-bearing external assets', async () => {
    const yaml = await readFile(fixture('content/authors/author.ada/en.yml'), 'utf8')
    await expect(parsePortableDocument(`${yaml}\nfields: {}`, contract, 'content/authors/author.ada/en.yml')).rejects.toMatchObject({ code: 'DOCUMENT_INVALID' })
    await expect(parsePortableDocument('{"ginko":{},"ginko":{},"fields":{}}', contract, 'content/example.json')).rejects.toMatchObject({ code: 'DOCUMENT_INVALID' })
    await expect(parsePortableDocument(yaml.replace('https://files.example.test/portrait.png', 'https://user:secret@files.example.test/portrait.png'), contract, 'content/authors/author.ada/en.yml')).rejects.toMatchObject({ code: 'DOCUMENT_INVALID' })
  })
})
