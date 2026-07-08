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

  test('isMissingDocument is the inverse and keys on a null body', () => {
    expect(isMissingDocument(missing)).toBe(true)
    expect(isMissingDocument(real)).toBe(false)
    // A body-less real document (e.g. an unsupported-extension stub) is treated
    // as missing regardless of the discriminant flag.
    expect(isMissingDocument({ id: 'x', body: null } as unknown as ParsedContent)).toBe(true)
  })

  test('the guard narrows a loader union to ParsedContent', () => {
    const variants: Array<ParsedContent | MissingDocument> = [missing, real]
    const parsed = variants.filter(isRealDocument)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.path).toBe('/docs/intro')
  })
})
