import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const schemaSafeParse = vi.hoisted(() => vi.fn(() => ({ success: true, data: {} })))

const runtimeContent = {
  ignores: ['\\.tmp$'],
  cacheIntegrity: 'integrity',
  collections: {
    docs: {
      source: '*.md',
      route: {
        en: '/docs',
        de: '/dokumentation'
      },
      i18n: {
        defaultLocale: 'en',
        locales: ['en', 'de']
      }
    }
  }
}

const storageState = new Map<string, any>()
const previewState = {
  enabled: false,
  key: 'preview-key'
}

vi.mock('../../packages/content/src/integrations/nitro/runtime-config', () => ({
  getContentRuntimeConfig: () => ({ content: runtimeContent })
}))

vi.mock('#content/virtual/config', () => ({
  default: {
    collections: {
      docs: {
        schema: {
          safeParse: schemaSafeParse
        }
      }
    }
  }
}))

vi.mock('unstorage', () => ({
  prefixStorage: (storage: any, prefix: string) => ({
    async getKeys(keyPrefix = '') {
      return (await storage.getKeys(`${prefix}:${keyPrefix}`)).map((key: string) => key.slice(`${prefix}:`.length))
    },
    async getMeta(key: string) {
      return storage.getMeta(`${prefix}:${key}`)
    },
    async getItem(key: string) {
      return storage.getItem(`${prefix}:${key}`)
    }
  })
}))

vi.mock('nitropack/runtime', () => ({
  useNitroApp: () => ({
    hooks: {
      callHook: vi.fn()
    }
  }),
  useStorage: () => ({
    getKeys: async (prefix = '') => Array.from(storageState.keys()).filter(key => key.startsWith(prefix)),
    getMeta: async (key: string) => storageState.get(key)?._meta || null,
    getItem: async (key: string) => storageState.get(key)?._body ?? storageState.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      storageState.set(key, value)
    }
  })
}))

vi.mock('../../packages/content/src/integrations/nitro/preview', () => ({
  isPreview: () => previewState.enabled,
  getPreview: () => ({ key: previewState.key })
}))

describe('storage access contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    storageState.clear()
    schemaSafeParse.mockReset()
    schemaSafeParse.mockReturnValue({ success: true, data: {} })
    previewState.enabled = false
    previewState.key = 'preview-key'
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('contentIgnorePredicate blocks ignored and invalid ids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { contentIgnorePredicate } = await import('../../packages/content/src/runtime/server/storage-access')

    expect(contentIgnorePredicate('content:file.md')).toBe(true)
    expect(contentIgnorePredicate('content:file.tmp')).toBe(false)
    expect(contentIgnorePredicate('content:bad?name.md')).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  test('contentConfig keeps serializable runtime metadata and live collection schemas', async () => {
    const { contentConfig } = await import('../../packages/content/src/runtime/server/storage-access')
    const config = contentConfig()

    expect(config.collections.docs).toMatchObject({
      source: '*.md',
      route: {
        en: '/docs',
        de: '/dokumentation'
      },
      i18n: {
        defaultLocale: 'en',
        locales: ['en', 'de']
      }
    })
    expect(config.collections.docs.schema).toMatchObject({
      safeParse: expect.any(Function)
    })
  })

  test('getContentsList validates parsed source against live collection schemas', async () => {
    schemaSafeParse.mockReturnValue({
      success: false,
      error: {
        issues: [{ path: ['title'], message: 'Required' }]
      }
    })
    storageState.set('content:source:content:intro.md', {
      _meta: { mtime: 1, size: 12 },
      _body: '---\ndescription: Missing title\n---\n'
    })

    const { getContentsList } = await import('../../packages/content/src/storage/contents')

    await expect(getContentsList({} as any)).rejects.toMatchObject({
      code: 'SCHEMA_VALIDATION_FAILED',
      context: {
        collection: 'docs'
      }
    })
    expect(schemaSafeParse).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Missing title'
    }))
  })

  test('getContentsList serves the production snapshot instead of parsed artifacts', async () => {
    process.env.NODE_ENV = 'production'
    schemaSafeParse.mockReturnValue({
      success: false,
      error: {
        issues: [{ path: ['title'], message: 'Required' }]
      }
    })
    storageState.set('cache:content:parsed:content:intro.md', {
      parsed: [{
        id: 'content:intro.md',
        path: '/intro',
        title: 'Old Parsed Intro'
      }],
      hash: 'bundled-hash'
    })
    storageState.set('cache:content:snapshot.json', {
      version: 1,
      integrity: 'integrity',
      generatedAt: 1,
      documentIds: ['content:intro.md'],
      documentSourceIds: ['content:intro.md'],
      documents: [{
        id: 'content:intro.md',
        path: '/intro',
        title: 'Snapshot Intro'
      }]
    })
    storageState.set('content:source:content:intro.md', {
      _meta: { mtime: 1, size: 12 },
      _body: '---\ndescription: Missing title\n---\n'
    })

    const { getContentsList } = await import('../../packages/content/src/storage/contents')

    await expect(getContentsList({} as any)).resolves.toEqual([
      expect.objectContaining({
        id: 'content:intro.md',
        path: '/intro',
        title: 'Snapshot Intro'
      })
    ])
    expect(schemaSafeParse).not.toHaveBeenCalled()
  })

  test('getContentsIds serves production ids from the snapshot', async () => {
    process.env.NODE_ENV = 'production'
    storageState.set('cache:content:snapshot.json', {
      version: 1,
      integrity: 'integrity',
      generatedAt: 1,
      documentIds: [
        'content:guide:intro.md',
        'content:guide:intro.md#__locale=de',
        'content:blog:hello.md'
      ],
      documentSourceIds: [
        'content:blog:hello.md',
        'content:guide:intro.md'
      ],
      documents: [
        { id: 'content:guide:intro.md', path: '/guide/intro' },
        { id: 'content:guide:intro.md#__locale=de', path: '/de/guide/intro' },
        { id: 'content:blog:hello.md', path: '/blog/hello' }
      ]
    })
    storageState.set('content:source:content:guide:stale.md', { _meta: {} })

    const { getContentsIds } = await import('../../packages/content/src/runtime/server/storage-access')

    await expect(getContentsIds({} as any, 'content:guide:')).resolves.toEqual([
      'content:guide:intro.md'
    ])
  })

  test('getContentsIds merges preview overrides and deletions', async () => {
    storageState.set('content:source:content:guide:intro.md', { _meta: {} })
    storageState.set('content:source:content:guide:advanced.md', { _meta: {} })
    storageState.set('content:source:preview:preview-key:content:guide:intro.md', { _meta: { __deleted: true } })
    storageState.set('content:source:preview:preview-key:content:guide:new.md', { _meta: {} })

    previewState.enabled = true

    const { getContentsIds } = await import('../../packages/content/src/runtime/server/storage-access')
    const ids = await getContentsIds({} as any, 'content:guide:')

    expect(ids).toEqual([
      'content:guide:advanced.md',
      'content:guide:new.md'
    ])
  })

  test('resolveStorageId prefers preview drafts when available', async () => {
    storageState.set('content:source:preview:preview-key:content:guide:intro.md', '# Draft')
    previewState.enabled = true

    const { resolveStorageId } = await import('../../packages/content/src/runtime/server/storage-access')

    await expect(resolveStorageId({} as any, 'content:guide:intro.md')).resolves.toBe('preview:preview-key:content:guide:intro.md')
    previewState.enabled = false
    await expect(resolveStorageId({} as any, 'content:guide:intro.md')).resolves.toBe('content:guide:intro.md')
  })
})
