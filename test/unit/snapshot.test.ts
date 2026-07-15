import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  assertSnapshotComplete,
  buildContentSnapshot,
  CONTENT_SNAPSHOT_VERSION,
  ContentSnapshotError
} from '../../packages/content/src/core/content/snapshot'
import type { ContentSnapshot } from '../../packages/content/src/core/content/snapshot'
import type { ParsedContent } from '../../packages/content/src/types/content'

/**
 * Behavior suite (T6.2 #4): snapshot completeness and process-loader identity.
 *  - build-writer: a snapshot missing a source document fails the completeness
 *    assertion, naming the offender (T2.2).
 *  - process loader: two concurrent `getProcessGraph` calls share one
 *    in-flight load and return the same graph object (single-flight).
 *  - integrity: a config-integrity change rebuilds a fresh graph; a snapshot
 *    whose integrity disagrees with the runtime fails loudly.
 *
 * The loader tests mock `storage/driver` (the only seam `snapshot-runtime`
 * reads for the cache store + config) so the real single-flight/rebuild logic
 * runs unmocked against controllable inputs.
 */

const doc = (overrides: Partial<ParsedContent> = {}): ParsedContent => ({
  id: 'content:en:docs:intro.md',
  path: '/docs/intro',
  file: { source: 'content', path: '/en/docs/intro.md', extension: 'md' },
  type: 'markdown',
  locale: 'en',
  canonicalKey: 'docs/intro',
  collection: 'docs',
  body: { type: 'root', children: [] },
  ...overrides
}) as ParsedContent

const snapshot = (overrides: Partial<ContentSnapshot> = {}): ContentSnapshot => ({
  version: CONTENT_SNAPSHOT_VERSION,
  integrity: 'integrity',
  generatedAt: 1,
  documentIds: ['content:en:docs:intro.md'],
  documentSourceIds: ['content:en:docs:intro.md'],
  documents: [doc()],
  ...overrides
})

// Mutable seam controlling what the mocked driver returns per test.
const driver = vi.hoisted(() => ({
  integrity: 'integrity',
  snapshot: null as unknown,
  getItemCalls: 0
}))

vi.mock('../../packages/content/src/storage/driver', () => ({
  cacheStorage: () => ({
    getItem: async () => {
      driver.getItemCalls += 1
      return driver.snapshot
    }
  }),
  contentConfig: () => ({
    cacheIntegrity: driver.integrity,
    locales: ['en'],
    defaultLocale: 'en'
  })
}))

describe('snapshot build-writer completeness (T2.2)', () => {
  test('a snapshot missing a source document fails the completeness assertion, naming it', () => {
    const built = buildContentSnapshot({
      integrity: 'integrity',
      now: 1,
      sourceIds: ['content:en:docs:intro.md', 'content:en:docs:missing.md'],
      documents: [doc()]
    })

    expect(() => assertSnapshotComplete(built, ['content:en:docs:intro.md', 'content:en:docs:missing.md']))
      .toThrow('content:en:docs:missing.md')
    expect(() => assertSnapshotComplete(built, ['content:en:docs:intro.md', 'content:en:docs:missing.md']))
      .toThrow(ContentSnapshotError)
  })

  test('a complete snapshot passes the completeness assertion', () => {
    const built = buildContentSnapshot({
      integrity: 'integrity',
      now: 1,
      sourceIds: ['content:en:docs:intro.md'],
      documents: [doc()]
    })

    expect(() => assertSnapshotComplete(built, ['content:en:docs:intro.md'])).not.toThrow()
  })
})

describe('process snapshot loader identity + integrity', () => {
  beforeEach(() => {
    vi.resetModules()
    driver.integrity = 'integrity'
    driver.snapshot = snapshot()
    driver.getItemCalls = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('two concurrent getProcessGraph calls share one load and one graph object (single-flight)', async () => {
    const { getProcessGraph } = await import('../../packages/content/src/storage/snapshot-runtime')
    const event = {} as never

    // Kick off both before awaiting either → they must share the in-flight promise.
    const [first, second] = await Promise.all([getProcessGraph(event), getProcessGraph(event)])

    expect(second).toBe(first)
    expect(driver.getItemCalls).toBe(1)
  })

  test('a config-integrity change rebuilds a fresh graph object', async () => {
    const { getProcessGraph } = await import('../../packages/content/src/storage/snapshot-runtime')
    const event = {} as never

    const first = await getProcessGraph(event)
    expect(driver.getItemCalls).toBe(1)

    // Bump both the runtime integrity and the stored snapshot to the new build.
    driver.integrity = 'integrity-v2'
    driver.snapshot = snapshot({ integrity: 'integrity-v2' })

    const second = await getProcessGraph(event)
    expect(second).not.toBe(first)
    expect(driver.getItemCalls).toBe(2)
  })

  test('a stale snapshot whose integrity disagrees with the runtime fails loudly', async () => {
    driver.snapshot = snapshot({ integrity: 'old-integrity' })
    const { getProcessGraph } = await import('../../packages/content/src/storage/snapshot-runtime')

    await expect(getProcessGraph({} as never)).rejects.toThrow('snapshot integrity mismatch')
  })
})
