import type { ResolvedContentContractV1, ResolvedContentFieldV1 } from '../cms-contract/types.js'
import {
  classifyPortableMdc,
  decodePortableIdentitySegment,
  encodePortableIdentitySegment,
  parsePortableDocument,
  parsePortableManifest,
  portableDocumentPath,
  serializePortableDocument,
  serializePortableManifest,
  sha256Hex,
  type PortableDocumentV1,
  type PortableManifestV1,
  type PortableAssetBlobV1,
} from '../portability/index.js'

export interface PortabilityContractImplementation {
  encodeIdentitySegment(value: string): string
  decodeIdentitySegment(value: string): string
  parseDocument(source: string, contract: ResolvedContentContractV1, file?: string): Promise<PortableDocumentV1>
  serializeDocument(document: PortableDocumentV1, contract: ResolvedContentContractV1): Promise<string>
  documentPath(document: PortableDocumentV1, contract: ResolvedContentContractV1): string
  parseManifest(source: Uint8Array): PortableManifestV1
  serializeManifest(manifest: PortableManifestV1): Uint8Array
  sha256(bytes: Uint8Array): Promise<string>
  classifyMdc(source: string, contract: ResolvedContentContractV1): Promise<'portable' | 'rejected'>
}

const defaultImplementation: PortabilityContractImplementation = {
  encodeIdentitySegment: encodePortableIdentitySegment,
  decodeIdentitySegment: decodePortableIdentitySegment,
  parseDocument: (source, contract, file) => parsePortableDocument(source, contract, file ?? null),
  serializeDocument: serializePortableDocument,
  documentPath: portableDocumentPath,
  parseManifest: parsePortableManifest,
  serializeManifest: serializePortableManifest,
  sha256: sha256Hex,
  classifyMdc: async (source, contract) => (await classifyPortableMdc(source, contract.collections.docs!.componentPolicy)).classification,
}

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

export const PORTABILITY_CONTRACT_FIXTURES = Object.freeze({
  png: Object.freeze({
    bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15, 0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]),
    sha256: '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460',
  }),
  document: `---
ginko:
  version: 1
  collection: docs
  canonicalKey: docs.introduction
  locale: en
  slug: introduction
  parentCanonicalKey: null
  order: "0000000000010000"
  visibility:
    navigation: true
    search: true
    sitemap: true
title: Introduction
---
# Portable

::callout{tone="info"}
Safe content.
::
`,
})

export function createPortabilityContractFixture(): ResolvedContentContractV1 {
  return {
    format: 'ginko-content-contract', version: 1, defaultLocale: 'en', locales: ['en'], localeFallbacks: { en: [] },
    collections: {
      docs: {
        id: 'docs', kind: 'page', structure: 'tree', defaultLocale: 'en', locales: ['en'],
        routing: { mode: 'route', pathPrefix: '', localizedPathPrefixes: null, localizedSingletonPaths: null, slugMode: 'shared', rootSlug: null, singleton: false, allowMultipleRoots: true },
        fields: [field('title', 'text', true, { role: 'title', required: true }), field('body', 'richtext', true, { role: 'body' })],
        portable: { format: 'mdc', bodyField: 'body' },
        componentPolicy: { components: { callout: { kind: 'block', props: { tone: { type: 'string', required: true } }, slots: ['default'], media: null } } },
      },
    },
  }
}

export async function runPortabilityContract(implementation: PortabilityContractImplementation = defaultImplementation): Promise<{ checks: number }> {
  let checks = 0
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(`Portability contract failed: ${message}`); checks++ }
  const contract = createPortabilityContractFixture()
  check(await implementation.sha256(PORTABILITY_CONTRACT_FIXTURES.png.bytes) === PORTABILITY_CONTRACT_FIXTURES.png.sha256, 'incremental SHA-256 vector')
  const encoded = implementation.encodeIdentitySegment('café %')
  check(encoded === 'caf%C3%A9%20%25' && implementation.decodeIdentitySegment(encoded) === 'café %', 'reversible canonical segment')
  let rejectedPath = false
  try { implementation.decodeIdentitySegment('%2f') } catch (error) { rejectedPath = (error as { code?: string }).code === 'PATH_INVALID' }
  check(rejectedPath, 'lowercase escape rejection')
  const document = await implementation.parseDocument(PORTABILITY_CONTRACT_FIXTURES.document, contract, 'content/moved.md')
  check(document.canonicalKey === 'docs.introduction', 'materialized identity')
  check(implementation.documentPath(document, contract) === 'content/docs/docs.introduction/en.md', 'canonical path')
  check(JSON.stringify(await implementation.parseDocument(await implementation.serializeDocument(document, contract), contract)) === JSON.stringify(document), 'document round trip')
  check(await implementation.classifyMdc('::callout{tone="info"}\nSafe\n::', contract) === 'portable', 'portable MDC')
  check(await implementation.classifyMdc('<script>unsafe</script>', contract) === 'rejected', 'active MDC rejection')
  const emptyHash = await implementation.sha256(new Uint8Array())
  const manifest: PortableManifestV1 = {
    format: 'ginko-content-portable', version: 1,
    contract: { file: '.ginko/content-contract.json', sha256: emptyHash },
    documents: [{ identity: { collection: document.collection, canonicalKey: document.canonicalKey, locale: document.locale }, file: 'content/docs/docs.introduction/en.md', sha256: emptyHash }],
    assets: [],
  }
  const manifestBytes = implementation.serializeManifest(manifest)
  const rebuiltManifestBytes = implementation.serializeManifest(implementation.parseManifest(manifestBytes))
  check(manifestBytes[manifestBytes.length - 1] === 10 && manifestBytes.every((byte, index) => rebuiltManifestBytes[index] === byte), 'canonical manifest round trip')
  return { checks }
}

export interface PortableDirectoryContractImplementation {
  firstDestination: string
  secondDestination: string
  write(destination: string, input: { contract: ResolvedContentContractV1; documents: PortableDocumentV1[]; assets: Array<PortableAssetBlobV1 & { content: Uint8Array }> }): Promise<void>
  read(destination: string): Promise<{ documents: Array<{ document: PortableDocumentV1 }> }>
  rebuildManifest(destination: string): Promise<PortableManifestV1>
  readManifestBytes(destination: string): Promise<Uint8Array>
}

export async function runPortableDirectoryContract(implementation: PortableDirectoryContractImplementation): Promise<{ checks: number }> {
  const contract = createPortabilityContractFixture()
  const document = await parsePortableDocument(PORTABILITY_CONTRACT_FIXTURES.document, contract)
  const input = { contract, documents: [document], assets: [] }
  await implementation.write(implementation.firstDestination, input)
  await implementation.write(implementation.secondDestination, input)
  let checks = 0
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(`Portable directory contract failed: ${message}`); checks++ }
  const first = await implementation.readManifestBytes(implementation.firstDestination)
  const second = await implementation.readManifestBytes(implementation.secondDestination)
  check(first.length === second.length && first.every((byte, index) => second[index] === byte), 'deterministic writes')
  const read = await implementation.read(implementation.firstDestination)
  check(read.documents.length === 1 && read.documents[0]!.document.canonicalKey === document.canonicalKey, 'semantic read')
  await implementation.rebuildManifest(implementation.firstDestination)
  const rebuilt = await implementation.readManifestBytes(implementation.firstDestination)
  check(first.length === rebuilt.length && first.every((byte, index) => rebuilt[index] === byte), 'deterministic manifest rebuild')
  return { checks }
}
