import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildContentGraph } from '../../packages/content/src/core/content/graph'
import { executeQueryPlan } from '../../packages/content/src/core/query/execute'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
import { compileWhere } from '../../packages/content/src/core/query/filter'
import { SUPPORTED_QUERY_OPERATORS } from '../../packages/content/src/core/query/operators'
import { filesystemProvider } from '../../packages/content/src/runtime/server/providers/filesystem'
import { validateContentQueryRequestBody } from '../../packages/content/src/runtime/server/query-http-validation'
import type { ParsedContent } from '../../packages/content/src/types/content'

/**
 * VNEXT.md 20.7/26.3: one source-of-truth assertion tying the public operator
 * constant/type, the filesystem executor, the filesystem's advertised
 * capabilities, the HTTP validator, a provider conformance probe, and the
 * documentation table together. `$nin` is asserted explicitly everywhere so it
 * cannot silently drift out of any one of these six places again — its
 * internal execution lowering to `$not`/`$in`-shaped semantics is an
 * implementation detail invisible to every one of these six checks.
 */
describe('query operator parity ($nin makes drift impossible)', () => {
  test('the public operator constant is the one canonical operator list and includes $nin', () => {
    expect(SUPPORTED_QUERY_OPERATORS).toContain('$nin')
    // Sanity: every canonical operator is `$`-prefixed and unique.
    expect(new Set(SUPPORTED_QUERY_OPERATORS).size).toBe(SUPPORTED_QUERY_OPERATORS.length)
    expect(SUPPORTED_QUERY_OPERATORS.every(operator => operator.startsWith('$'))).toBe(true)
  })

  test('the public QueryWhere/QueryOperators compiler accepts $nin and lowers it losslessly', () => {
    // `compileWhere` is the public QueryWhere -> internal builder-where seam
    // (features/query -> core/query/filter.ts); $nin here proves the public
    // type surface (`QueryOperators.$nin`) and the compiler agree.
    expect(compileWhere({ status: { $nin: ['draft', 'archived'] } } as never)).toEqual({
      status: { $not: { $in: ['draft', 'archived'] } }
    })
  })

  test('the filesystem executor genuinely executes $nin (positive and negative cases)', () => {
    const graph = buildContentGraph([
      { id: 'a', path: '/a', collection: 'docs', locale: 'en', canonicalKey: 'a', body: { type: 'root', children: [] }, status: 'draft' },
      { id: 'b', path: '/b', collection: 'docs', locale: 'en', canonicalKey: 'b', body: { type: 'root', children: [] }, status: 'published' },
      { id: 'c', path: '/c', collection: 'docs', locale: 'en', canonicalKey: 'c', body: { type: 'root', children: [] }, status: 'archived' }
    ] as unknown as ParsedContent[])

    // Positive: $nin excludes named values and keeps the rest.
    const plan = lowerQueryPlan({ collection: 'docs', where: [{ status: { $nin: ['draft', 'archived'] } }] } as never)
    const response = executeQueryPlan<ParsedContent>(graph, plan)
    expect((response.result as ParsedContent[]).map(doc => doc.path)).toEqual(['/b'])

    // Negative: an empty $nin list excludes nothing.
    const emptyPlan = lowerQueryPlan({ collection: 'docs', where: [{ status: { $nin: [] } }] } as never)
    const emptyResponse = executeQueryPlan<ParsedContent>(graph, emptyPlan)
    expect((emptyResponse.result as ParsedContent[])).toHaveLength(3)
  })

  test('the filesystem provider advertises $nin in capabilities.query.operators', () => {
    expect(filesystemProvider.capabilities.query.operators).toContain('$nin')
  })

  test('the HTTP validator accepts $nin as a known operator', () => {
    const result = validateContentQueryRequestBody({
      collection: 'docs',
      where: [{ status: { $nin: ['draft', 'archived'] } }]
    })
    expect(result.ok).toBe(true)

    const rejected = validateContentQueryRequestBody({
      collection: 'docs',
      where: [{ status: { $near: 'draft' } }]
    })
    expect(rejected.ok).toBe(false)
  })

  test('the documentation operator reference table lists $nin', () => {
    const docsPath = resolve(__dirname, '../../docs/content/docs/5.reference/9.query-operators.md')
    const source = readFileSync(docsPath, 'utf8')
    const operatorRows = [...source.matchAll(/\|\s*`(\$\w+)`\s*\|/g)].map(match => match[1])

    expect(operatorRows).toContain('$nin')
    // Every operator the filesystem provider advertises (beyond $options,
    // which is a $regex modifier only, and $and/$or which are logical
    // connectives already documented under "Grouped logic") should be
    // discoverable in the same reference table.
    const documentedOnlyCompareOperators = SUPPORTED_QUERY_OPERATORS.filter(operator => operator !== '$options')
    for (const operator of documentedOnlyCompareOperators) {
      expect(operatorRows).toContain(operator)
    }
  })
})
