import { describe, expect, test } from 'vitest'
import { executeQueryPlanOnDocuments } from '../../packages/content/src/core/query/execute'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
import type { ContentQuerySortOptions } from '../../packages/content/src/types/query'

/**
 * Behavior suite (T6.2 #2): sort stability and tiebreaks through the plan
 * executor. `executeQueryPlanOnDocuments` applies exactly the sort a real
 * query would; these tests pin the contract that
 *  - equal primary keys preserve input order (stable sort),
 *  - later sort clauses act only as tiebreakers, and
 *  - the `numeric` / `caseFirst` / `sensitivity` collator knobs are honored.
 */

const sortTitles = (
  documents: Array<Record<string, unknown>>,
  sort: ContentQuerySortOptions[]
): string[] => {
  const plan = lowerQueryPlan({ sort } as never)
  const response = executeQueryPlanOnDocuments(documents, plan)
  return (response.result as Array<Record<string, unknown>>).map(doc => doc.title as string)
}

describe('query sort stability and tiebreaks', () => {
  test('equal primary keys preserve input order (stable)', () => {
    // All share group 'a'; a stable sort must keep the authored order.
    const documents = [
      { title: 'first', group: 'a' },
      { title: 'second', group: 'a' },
      { title: 'third', group: 'a' },
      { title: 'fourth', group: 'a' }
    ]

    expect(sortTitles(documents, [{ group: 1 }])).toEqual([
      'first',
      'second',
      'third',
      'fourth'
    ])
  })

  test('multi-clause: earlier field dominates, later field breaks ties', () => {
    const documents = [
      { title: 'a-2', group: 'a', order: 2 },
      { title: 'b-1', group: 'b', order: 1 },
      { title: 'a-1', group: 'a', order: 1 },
      { title: 'b-2', group: 'b', order: 2 }
    ]

    expect(sortTitles(documents, [{ group: 1, order: 1 }])).toEqual([
      'a-1',
      'a-2',
      'b-1',
      'b-2'
    ])
  })

  test('tiebreak preserves input order when the tiebreak field is also equal', () => {
    // group + order identical for the two 'a/1' docs → stability decides.
    const documents = [
      { title: 'a-1-x', group: 'a', order: 1 },
      { title: 'b-1', group: 'b', order: 1 },
      { title: 'a-1-y', group: 'a', order: 1 }
    ]

    expect(sortTitles(documents, [{ group: 1, order: 1 }])).toEqual([
      'a-1-x',
      'a-1-y',
      'b-1'
    ])
  })

  test('numeric honored — natural number order vs lexicographic', () => {
    const documents = [
      { title: 'file10', name: 'file10' },
      { title: 'file2', name: 'file2' },
      { title: 'file1', name: 'file1' }
    ]

    expect(sortTitles(documents, [{ name: 1, $numeric: true }])).toEqual([
      'file1',
      'file2',
      'file10'
    ])
    // Without `$numeric` the collator sorts lexicographically: file10 < file2.
    expect(sortTitles(documents, [{ name: 1 }])).toEqual([
      'file1',
      'file10',
      'file2'
    ])
  })

  test('caseFirst honored — upper-first vs lower-first among equal letters', () => {
    const documents = [
      { title: 'lower-a', name: 'a' },
      { title: 'upper-A', name: 'A' },
      { title: 'lower-b', name: 'b' },
      { title: 'upper-B', name: 'B' }
    ]

    expect(sortTitles(documents, [{ name: 1, $caseFirst: 'upper' }])).toEqual([
      'upper-A',
      'lower-a',
      'upper-B',
      'lower-b'
    ])
    expect(sortTitles(documents, [{ name: 1, $caseFirst: 'lower' }])).toEqual([
      'lower-a',
      'upper-A',
      'lower-b',
      'upper-B'
    ])
  })

  test('sensitivity honored — base collapses case so stability decides order', () => {
    // With sensitivity 'base', 'A' and 'a' compare equal, so the two of them
    // keep input order and both sort before 'b'.
    const documents = [
      { title: 'x-b', name: 'b' },
      { title: 'x-A', name: 'A' },
      { title: 'x-a', name: 'a' }
    ]

    expect(sortTitles(documents, [{ name: 1, $sensitivity: 'base' }])).toEqual([
      'x-A',
      'x-a',
      'x-b'
    ])
  })
})
