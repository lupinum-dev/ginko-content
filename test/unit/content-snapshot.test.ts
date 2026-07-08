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

  test('rejects documents that would lose data during JSON serialization', () => {
    expect(() => buildContentSnapshot({
      integrity: 'integrity',
      now: 123,
      sourceIds: ['content:docs:intro.md'],
      documents: [doc({ publishedAt: new Date('2026-01-01') } as Partial<ParsedContent>)]
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
