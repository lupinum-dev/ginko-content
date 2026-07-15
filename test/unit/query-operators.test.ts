import { describe, expect, test } from 'vitest'
import { buildContentGraph } from '../../packages/content/src/core/content/graph'
import { executeQueryPlan } from '../../packages/content/src/core/query/execute'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
import type { ContentQueryBuilderWhere } from '../../packages/content/src/types/query'
import type { ParsedContent } from '../../packages/content/src/types/content'

/**
 * Behavior suite (T6.2 #1): the complete `CompareOperator` matrix executed
 * through `executeQueryPlan` — the real public execution path — never through
 * the internal `compareOperators` table. A fixed 12-document dataset gives each
 * operator a hit case, a miss case, and an edge case (null field, empty/array
 * field, numeric-vs-string). If an operator's semantics regress, the matching
 * row here goes red.
 */

interface Row {
  n: number
  title: string
  tags: string[]
  score: unknown
  summary?: unknown
}

// Fixed dataset. Chosen so every operator has a discriminating case:
//  - `score` mixes number / string / null → `type` + numeric-vs-string edges
//  - `summary` is present, null, or absent → `exists` edge (null still exists)
//  - `tags` includes an empty array (doc 4) → array/`contains` edge
const ROWS: Row[] = [
  { n: 1, title: 'Apple Pie', tags: ['fruit', 'dessert'], score: 10, summary: 'sweet' },
  { n: 2, title: 'apple juice', tags: ['fruit', 'drink'], score: 20, summary: 'cold' },
  { n: 3, title: 'Banana Bread', tags: ['fruit', 'bread'], score: 30, summary: 'warm' },
  { n: 4, title: 'Cherry', tags: [], score: '40', summary: null },
  { n: 5, title: 'Date', tags: ['fruit'], score: 50 },
  { n: 6, title: 'Elderberry', tags: ['fruit', 'wild'], score: 60, summary: 'tart' },
  { n: 7, title: 'Fig', tags: ['fruit'], score: null, summary: 'purple' },
  { n: 8, title: 'Grape', tags: ['fruit', 'vine'], score: 80, summary: 'green' },
  { n: 9, title: 'Honeydew', tags: ['melon'], score: 90, summary: 'mild' },
  { n: 10, title: 'Kiwi', tags: ['fruit', 'fuzzy'], score: 100, summary: 'tangy' },
  { n: 11, title: 'Lemon', tags: ['citrus'], score: 110, summary: 'sour' },
  { n: 12, title: 'Mango', tags: ['fruit', 'tropical'], score: 120, summary: 'juicy' }
]

const graph = buildContentGraph(ROWS.map(row => ({
  id: `content:en:docs:${row.n}.md`,
  path: `/docs/${row.n}`,
  file: { source: 'content', path: `/en/docs/${row.n}.md`, extension: 'md' },
  type: 'markdown',
  locale: 'en',
  canonicalKey: `docs/${row.n}`,
  collection: 'docs',
  body: { type: 'root', children: [] },
  order: row.n,
  title: row.title,
  tags: row.tags,
  score: row.score,
  ...(('summary' in row) ? { summary: row.summary } : {})
}) as unknown as ParsedContent))

// Run a where clause through the full plan → graph executor and return the
// matched documents' `n` values, numerically sorted so assertions are
// order-independent (sort behavior has its own suite).
const match = (where: ContentQueryBuilderWhere): number[] => {
  const plan = lowerQueryPlan({ collection: 'docs', where: [where] } as never)
  const response = executeQueryPlan<Record<string, unknown>>(graph, plan)
  return (response.result as Array<Record<string, unknown>>)
    .map(doc => doc.order as number)
    .sort((a, b) => a - b)
}

describe('query operator matrix (executeQueryPlan)', () => {
  test('eq — hit, miss, and strict numeric-vs-string edge (no coercion)', () => {
    expect(match({ title: 'Cherry' })).toEqual([4])
    expect(match({ title: 'Nonexistent' })).toEqual([])
    expect(match({ order: 3 })).toEqual([3])
    // `eq` is strict identity: the string '3' does not equal the number 3.
    expect(match({ order: '3' })).toEqual([])
  })

  test('ne — excludes the single match, keeps the rest', () => {
    expect(match({ title: { $ne: 'Cherry' } })).toEqual([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(match({ title: { $ne: 'Nonexistent' } })).toHaveLength(12)
  })

  test('gt / gte — numeric boundary is exclusive vs inclusive', () => {
    expect(match({ order: { $gt: 10 } })).toEqual([11, 12])
    expect(match({ order: { $gte: 10 } })).toEqual([10, 11, 12])
  })

  test('lt / lte — numeric boundary is exclusive vs inclusive', () => {
    expect(match({ order: { $lt: 3 } })).toEqual([1, 2])
    expect(match({ order: { $lte: 3 } })).toEqual([1, 2, 3])
  })

  test('in — scalar membership and array-field membership', () => {
    expect(match({ order: { $in: [1, 2, 999] } })).toEqual([1, 2])
    // Edge: item is itself an array → membership by `includes`.
    expect(match({ tags: { $in: ['melon'] } })).toEqual([9])
  })

  test('nin — first-class negated membership, exact inverse of $in', () => {
    const inMatches = new Set(match({ order: { $in: [1, 2, 999] } }))
    const ninMatches = new Set(match({ order: { $nin: [1, 2, 999] } }))
    expect([...inMatches].some(n => ninMatches.has(n))).toBe(false)
    expect(inMatches.size + ninMatches.size).toBe(ROWS.length)
    // Edge: array-field membership negation.
    expect(match({ tags: { $nin: ['melon'] } })).not.toContain(9)
    expect(match({ tags: { $nin: ['melon'] } })).toContain(1)
  })

  test('contains — every entry present; array and case-sensitive string haystacks', () => {
    expect(match({ tags: { $contains: ['fruit', 'dessert'] } })).toEqual([1])
    // String haystack is case-sensitive: only lowercase 'apple' matches.
    expect(match({ title: { $contains: 'apple' } })).toEqual([2])
    // Edge: the empty-array doc (4) can never contain anything.
    expect(match({ tags: { $contains: ['fruit'] } })).not.toContain(4)
  })

  test('containsAny — any one entry present', () => {
    expect(match({ tags: { $containsAny: ['citrus', 'vine'] } })).toEqual([8, 11])
    expect(match({ tags: { $containsAny: ['nope'] } })).toEqual([])
  })

  test('icontains — case-insensitive substring', () => {
    expect(match({ title: { $icontains: 'apple' } })).toEqual([1, 2])
    expect(match({ title: { $icontains: 'ZZ' } })).toEqual([])
  })

  test('exists — present (incl. null) vs absent', () => {
    // doc 5 has no `summary`; doc 4's `summary` is null but still "exists".
    expect(match({ summary: { $exists: true } })).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12])
    expect(match({ summary: { $exists: false } })).toEqual([5])
  })

  test('type — typeof discriminates number, string, and null-as-object', () => {
    expect(match({ score: { $type: 'string' } })).toEqual([4])
    expect(match({ score: { $type: 'object' } })).toEqual([7])
    expect(match({ score: { $type: 'number' } })).toEqual([1, 2, 3, 5, 6, 8, 9, 10, 11, 12])
  })

  test('regex — anchored match honors flags', () => {
    expect(match({ title: { $regex: /^A/ } })).toEqual([1])
    expect(match({ title: { $regex: /^a/i } })).toEqual([1, 2])
    expect(match({ title: { $regex: /^Z/ } })).toEqual([])
  })

  test('prefix — startsWith on the raw field value', () => {
    expect(match({ title: { $prefix: 'Ba' } })).toEqual([3])
    expect(match({ title: { $prefix: 'zzz' } })).toEqual([])
  })
})
