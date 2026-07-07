import { describe, expect, test } from 'vitest'
import { assertSnapshotComplete, buildContentSnapshot, ContentSnapshotError, isContentSnapshot } from '../../packages/content/src/core/content/snapshot'
import type { ParsedContent } from '../../packages/content/src/types/content'

const doc = (overrides: Partial<ParsedContent> = {}): ParsedContent => ({
  _id: 'content:docs:intro.md',
  _path: '/docs/intro',
  _file: 'docs/intro.md',
  _source: 'content',
  _type: 'markdown',
  _extension: 'md',
  _canonicalKey: '/docs/intro',
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
          _id: 'content:docs:intro.md#__locale=de',
          _locale: 'de',
          _path: '/de/docs/intro'
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
