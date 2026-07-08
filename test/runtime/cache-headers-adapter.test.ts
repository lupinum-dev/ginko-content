import { describe, expect, test } from 'vitest'
import type { H3Event } from 'h3'
import { headersContentCache } from '../../packages/content/src/runtime/server/cache-adapters'
import type { ContentCacheHint } from '../../packages/content/src/public/provider'

/**
 * T7.3: the headers cache adapter is the one adapter whose `apply` does work —
 * it must translate a cache hint into real HTTP response headers. The two
 * shipped inert adapters (`noopContentCache`, `vercelContentCache`) leave the
 * response untouched; this asserts the active one does not.
 */

const createHeaderRecordingEvent = () => {
  const headers = new Map<string, string>()
  const event = {
    node: {
      res: {
        setHeader: (name: string, value: string) => {
          headers.set(name.toLowerCase(), value)
        }
      }
    }
  } as unknown as H3Event
  return { event, headers }
}

describe('headersContentCache adapter', () => {
  test('apply sets Cache-Control (with SWR) and ETag from the hint', async () => {
    const { event, headers } = createHeaderRecordingEvent()
    const hint: ContentCacheHint = { maxAge: 60, swr: 600, etag: '"abc123"' }

    await headersContentCache().apply(event, hint)

    expect(headers.get('cache-control')).toBe('max-age=60, stale-while-revalidate=600')
    expect(headers.get('etag')).toBe('"abc123"')
  })

  test('apply emits Last-Modified and omits Cache-Control when maxAge is absent', async () => {
    const { event, headers } = createHeaderRecordingEvent()
    const lastModified = new Date('2026-07-07T00:00:00.000Z')
    const hint: ContentCacheHint = { etag: 'w/"x"', lastModified }

    await headersContentCache().apply(event, hint)

    expect(headers.has('cache-control')).toBe(false)
    expect(headers.get('etag')).toBe('w/"x"')
    expect(headers.get('last-modified')).toBe(lastModified.toUTCString())
  })

  test('invalidate is inert (no upstream store to purge)', async () => {
    await expect(headersContentCache().invalidate({ tags: ['t'], paths: ['/p'] })).resolves.toBeUndefined()
  })
})
