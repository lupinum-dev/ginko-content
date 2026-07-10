import { describe, expect, test } from 'vitest'
import { assertSnapshotComplete, buildContentSnapshot, ContentSnapshotError, isContentSnapshot } from '../../packages/content/src/core/content/snapshot'
import type { ParsedContent } from '../../packages/content/src/types/content'

const doc = (overrides: Partial<ParsedContent> = {}): ParsedContent => ({
  id: 'content:docs:intro.md',
  path: '/docs/intro',
  file: { source: 'content', path: 'docs/intro.md', extension: 'md' },
  type: 'markdown',
  canonicalKey: '/docs/intro',
  body: { type: 'root', children: [] },
  ...overrides
}) as ParsedContent

describe('content snapshots', () => {
  test('builds a JSON-pure snapshot with variant ids and source ids', () => {
    const snapshot = buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [
        doc(),
        doc({
          id: 'content:docs:intro.md#__locale=de',
          locale: 'de',
          path: '/de/docs/intro'
        })
      ]
    })

    expect(isContentSnapshot(snapshot)).toBe(true)
    expect(snapshot.documentIds).toEqual([
      'content:docs:intro.md',
      'content:docs:intro.md#__locale=de'
    ])
    expect(snapshot.documentSourceIds).toEqual(['content:docs:intro.md'])
  })

  test('rejects undefined-valued fields — the canonical JSON model has no undefined', () => {
    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [doc({ searchSection: undefined } as unknown as Partial<ParsedContent>)]
    })).toThrow(ContentSnapshotError)
  })

  test('rejects Date values — dates must already be normalized strings before the snapshot', () => {
    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [doc({ publishedAt: new Date('2026-01-01T00:00:00.000Z') } as Partial<ParsedContent>)]
    })).toThrow(ContentSnapshotError)
  })

  test('rejects invalid dates and genuinely lossy values (Map, undefined)', () => {
    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [doc({ publishedAt: new Date('not-a-date') } as Partial<ParsedContent>)]
    })).toThrow(ContentSnapshotError)
    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [doc({ meta: new Map([['a', 1]]) } as unknown as Partial<ParsedContent>)]
    })).toThrow(ContentSnapshotError)
  })

  test('accepts shared (non-circular) references — stringify duplicates them', () => {
    const sharedTags = ['a', 'b']
    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [doc({ tags: sharedTags, keywords: sharedTags } as Partial<ParsedContent>)]
    })).not.toThrow()
  })

  test('rejects circular references', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [doc({ meta: circular } as Partial<ParsedContent>)]
    })).toThrow(ContentSnapshotError)
  })

  test('rejects enumerable symbol-keyed properties and names the offending path', () => {
    const symbol = Symbol('secret')
    const document = doc({
      meta: {
        [symbol]: 'hidden'
      }
    } as unknown as Partial<ParsedContent>)

    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [document]
    })).toThrow(/content:docs:intro\.md:\$\.meta\[Symbol\(secret\)\] \(symbol-keyed property\)/)
  })

  test('rejects enumerable symbol-keyed properties carried on an array', () => {
    const symbol = Symbol('secret')
    const tags = ['a', 'b'] as string[] & Record<symbol, unknown>
    // JSON.stringify silently drops symbol-keyed properties on arrays too, so
    // the walker must flag them the same way it does for plain objects. Before
    // the array branch checked symbols, this array passed and the property was
    // lost on the snapshot round-trip.
    tags[symbol] = 'hidden'
    const document = doc({ tags } as unknown as Partial<ParsedContent>)

    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [document]
    })).toThrow(/content:docs:intro\.md:\$\.tags\[Symbol\(secret\)\] \(symbol-keyed property\)/)
  })

  test('reports path-level offenders across multiple documents', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md', 'content:docs:advanced.md'],
      documents: [
        doc({ id: 'content:docs:intro.md', meta: new Map([['a', 1]]) } as unknown as Partial<ParsedContent>),
        doc({ id: 'content:docs:advanced.md', meta: circular } as Partial<ParsedContent>)
      ]
    })).toThrow(/content:docs:intro\.md:\$\.meta.*content:docs:advanced\.md:\$\.meta\.self/)
  })

  test('reports every missing source id in the completeness assertion', () => {
    const snapshot = buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md', 'content:docs:missing.md'],
      documents: [doc()]
    })

    expect(() => assertSnapshotComplete(snapshot, ['content:docs:intro.md', 'content:docs:missing.md']))
      .toThrow('content:docs:missing.md')
  })
})
