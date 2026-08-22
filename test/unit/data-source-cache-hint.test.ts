import { describe, expect, it } from 'vitest'

import {
  CONTENT_DATA_SOURCE_LIMITS,
  createContentDataSourceCacheHint,
} from '../../packages/content/src/public/data-source'

describe('createContentDataSourceCacheHint', () => {
  it('fills every optional field and removes duplicate keys', () => {
    expect(createContentDataSourceCacheHint({
      tags: ['content:docs', 'content:docs'],
      paths: ['/docs', '/docs'],
      maxAge: 60,
    })).toEqual({
      tags: ['content:docs'],
      paths: ['/docs'],
      maxAge: 60,
      swr: null,
      etag: null,
      lastModified: null,
    })
    expect(createContentDataSourceCacheHint()).toEqual({
      tags: [],
      paths: [],
      maxAge: null,
      swr: null,
      etag: null,
      lastModified: null,
    })
  })

  it('rejects unknown fields, unsafe paths, credentials, and values above limits', () => {
    expect(() => createContentDataSourceCacheHint({ unknown: true } as never)).toThrow(/invalid shape/)
    expect(() => createContentDataSourceCacheHint({ paths: ['docs'] })).toThrow(/invalid value/)
    expect(() => createContentDataSourceCacheHint({
      tags: ['https://user:password@example.test/private'],
    })).toThrow(/credentials/)
    expect(() => createContentDataSourceCacheHint({
      maxAge: CONTENT_DATA_SOURCE_LIMITS.maxCacheTtlSeconds + 1,
    })).toThrow(/TTL/)
  })
})
