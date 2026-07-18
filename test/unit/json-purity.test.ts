import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { collectJsonPurityViolations, formatJsonPurityViolations, isJsonPure } from '../../packages/content/src/core/json-value'
import { validateDocumentJsonPurity } from '../../packages/content/src/storage/validation'
import { normalizeProviderDocument } from '../../packages/content/src/public/provider-document'
import { parseContentVariants } from '../../packages/content/src/integrations/nitro/ingest'
import type { ParsedContent } from '../../packages/content/src/types/content'

vi.stubGlobal('__ginkoTestNitroApp', {
  hooks: {
    callHook: vi.fn()
  }
})

const doc = (overrides: Partial<ParsedContent> = {}): ParsedContent => ({
  id: 'content:docs:intro.md',
  file: { source: 'content', path: 'docs/intro.md', extension: 'md' },
  path: '/docs/intro',
  type: 'markdown',
  canonicalKey: 'docs/intro',
  collection: 'docs',
  body: { type: 'root', children: [] },
  ...overrides
}) as ParsedContent

describe('core/json-value: the canonical JSON purity validator', () => {
  test('admits every JSON-pure shape', () => {
    expect(isJsonPure({
      a: null,
      b: 'text',
      c: true,
      d: 1.5,
      e: [1, 'two', { three: 3 }],
      f: { nested: { deeper: [null, false] } }
    })).toBe(true)
  })

  test('rejects Date with an actionable message', () => {
    const violations = collectJsonPurityViolations({ publishedAt: new Date('2026-01-01') })
    expect(violations).toEqual([
      expect.objectContaining({ path: '$.publishedAt', reason: expect.stringContaining('fields.date()') })
    ])
  })

  test('rejects Map, Set, undefined, bigint, non-finite numbers, class instances, symbols, cycles, and array holes', () => {
    class Custom {
      readonly kind = 'custom'
    }
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const holey = [1]
    holey[3] = 4 // creates holes at index 1 and 2

    const violations = collectJsonPurityViolations({
      aMap: new Map([['a', 1]]),
      aSet: new Set([1, 2]),
      anUndefined: undefined,
      aBigint: 10n,
      notFinite: Number.POSITIVE_INFINITY,
      notANumber: Number.NaN,
      instance: new Custom(),
      aFunction: () => {},
      aSymbolValue: Symbol('x'),
      circular,
      holey
    })

    const paths = violations.map(v => v.path)
    expect(paths).toEqual(expect.arrayContaining([
      '$.aMap',
      '$.aSet',
      '$.anUndefined',
      '$.aBigint',
      '$.notFinite',
      '$.notANumber',
      '$.instance',
      '$.aFunction',
      '$.aSymbolValue',
      '$.circular.self',
      '$.holey[1]',
      '$.holey[2]'
    ]))
  })

  test('rejects enumerable symbol-keyed properties', () => {
    const secret = Symbol('secret')
    const value: Record<string | symbol, unknown> = { visible: 'ok' }
    value[secret] = 'hidden'

    const violations = collectJsonPurityViolations(value)
    expect(formatJsonPurityViolations(violations)).toMatch(/symbol-keyed property/)
  })

  test('admits shared (non-circular) references, only flags true cycles', () => {
    const shared = ['a', 'b']
    expect(isJsonPure({ tags: shared, keywords: shared })).toBe(true)
  })
})

describe('storage/validation: validateDocumentJsonPurity (the pre-graph-insertion gate)', () => {
  test('passes a JSON-pure document through unchanged', () => {
    const document = doc({ publishedAt: '2026-01-01' } as Partial<ParsedContent>)
    const outcome = validateDocumentJsonPurity(document)
    expect(outcome).toMatchObject({ ok: true, value: document })
  })

  test('fails with NON_JSON_VALUE, naming the file, collection, and property path', () => {
    const document = doc({ publishedAt: new Date('2026-01-01') } as Partial<ParsedContent>)
    const outcome = validateDocumentJsonPurity(document)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('NON_JSON_VALUE')
      expect(outcome.error.message).toContain('docs/intro.md')
      expect(outcome.error.message).toContain('docs')
      expect(outcome.error.message).toContain('$.publishedAt')
      expect(outcome.error.context.violations).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: '$.publishedAt' })])
      )
    }
  })
})

describe('provider-document: normalizeProviderDocument runs the same JSON-purity gate', () => {
  const body = { type: 'root' as const, children: [] }

  test('passes JSON-pure provider input through', () => {
    const document = normalizeProviderDocument({
      collection: 'blog',
      locale: 'en',
      contentPath: '/blog/hello',
      body,
      publishedAt: '2026-01-01'
    })
    expect((document as Record<string, unknown>).publishedAt).toBe('2026-01-01')
  })

  test('throws NON_JSON_VALUE for a Date-valued provider field', () => {
    expect(() => normalizeProviderDocument({
      collection: 'blog',
      locale: 'en',
      contentPath: '/blog/hello',
      body,
      publishedAt: new Date('2026-01-01')
    })).toThrowError(expect.objectContaining({
      code: 'NON_JSON_VALUE',
      message: expect.stringContaining('$.publishedAt')
    }))
  })
})

describe('ingest: a schema-produced Date fails before graph insertion, in dev and build alike', () => {
  const runtimeOptions = {
    locales: ['en'],
    defaultLocale: 'en',
    translatedSlugs: false,
    respectPathCase: false,
    markdown: {},
    yaml: {},
    csv: {},
    collections: {
      posts: {
        source: 'posts/**/*.md',
        // A custom user Zod schema that (mis)produces a `Date` must be
        // rejected with an actionable error pointing at fields.date()/
        // fields.datetime() — never silently accepted.
        schema: z.object({
          title: z.string(),
          publishedAt: z.coerce.date()
        })
      }
    }
  } as any

  test('rejects a z.coerce.date() schema output before the document reaches the graph', async () => {
    await expect(parseContentVariants(
      'content:en:posts:hello.md',
      [
        '---',
        'title: Hello',
        'publishedAt: 2026-01-01',
        '---',
        'Body text.'
      ].join('\n'),
      runtimeOptions
    )).rejects.toMatchObject({
      code: 'NON_JSON_VALUE',
      context: {
        violations: expect.arrayContaining([expect.objectContaining({ path: '$.publishedAt' })])
      }
    })
  })
})
