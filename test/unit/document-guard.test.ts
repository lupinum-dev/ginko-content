import { describe, expect, test } from 'vitest'
import { isMissingDocument, isRealDocument } from '../../packages/content/src/core/content/document'
import type { MissingDocument, ParsedContent } from '../../packages/content/src/types/content'

const missing: MissingDocument = { id: 'content:docs:gone.md', body: null, missing: true }
const real = { id: 'content:docs:intro.md', path: '/docs/intro', body: { type: 'root', children: [] } } as ParsedContent

describe('shared document guard', () => {
  test('isRealDocument accepts parsed documents and rejects missing stubs', () => {
    expect(isRealDocument(real)).toBe(true)
    expect(isRealDocument(missing)).toBe(false)
  })

  test('isMissingDocument keys on the missing discriminant, not on a null body', () => {
    expect(isMissingDocument(missing)).toBe(true)
    expect(isMissingDocument(real)).toBe(false)
    // A body-less REAL document (data-style output from a custom transformer,
    // e.g. the transformer example's .names files) is NOT missing — keying on
    // body === null wrongly failed the snapshot completeness assertion for it
    // (caught by release:verify building examples/advanced/transformer).
    const bodylessData = { id: 'content:1.index.names', path: '/', body: null, names: ['John'] } as unknown as ParsedContent
    expect(isMissingDocument(bodylessData)).toBe(false)
    expect(isRealDocument(bodylessData)).toBe(true)
  })

  test('the guard narrows a loader union to ParsedContent', () => {
    const variants: Array<ParsedContent | MissingDocument> = [missing, real]
    const parsed = variants.filter(isRealDocument)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.path).toBe('/docs/intro')
  })
})
