import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'
import { doc } from '../contracts/_utils'

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  sourceHasItem: vi.fn(),
  getSourceContentIds: vi.fn()
}))

const runtimeContent = {
  collections: {
    docs: {
      type: 'page',
      localePolicy: {
        localized: false,
        locales: [],
        fallback: {},
        translatedSlugs: false,
        routeMounts: { default: '/' }
      }
    }
  },
  localePolicy: {
    collections: {
      docs: {
        localized: false,
        locales: [],
        fallback: {},
        translatedSlugs: false,
        routeMounts: { default: '/' }
      }
    }
  },
  locales: ['en'],
  defaultLocale: 'en',
  translatedSlugs: false,
  sitemap: false as const,
  validation: 'error' as const,
  cacheIntegrity: 'integrity'
}

vi.mock('../../packages/content/src/storage/snapshot-runtime', () => ({
  usesProcessSnapshot: true
}))

vi.mock('../../packages/content/src/integrations/nitro/storage', () => ({
  getSourceContentIds: mocks.getSourceContentIds,
  contentConfig: () => runtimeContent,
  cacheStorage: () => ({ getItem: mocks.getItem, setItem: mocks.setItem }),
  sourceStorage: () => ({ hasItem: mocks.sourceHasItem })
}))

vi.mock('../../packages/content/src/integrations/nitro/runtime-config', () => ({
  getContentRuntimeConfig: () => ({
    public: { content: { navigation: { fields: [] } } },
    content: runtimeContent
  })
}))

vi.mock('../../packages/content/src/storage/validation', async () => {
  const { ok } = await import('../../packages/content/src/core/result')
  return { validateContentGraph: vi.fn(() => ok(undefined)) }
})

describe('compiled content validation report reuse', () => {
  beforeEach(() => {
    mocks.getItem.mockReset()
    mocks.setItem.mockReset()
    mocks.sourceHasItem.mockReset()
    mocks.getSourceContentIds.mockReset()
  })

  test('reuses the build-owned report without source-dependent revalidation or writes', async () => {
    const document = doc({
      id: 'content:docs:guide.md',
      collection: 'docs',
      path: '/guide',
      canonicalKey: 'docs/guide',
      file: { source: 'content', path: 'guide.md', stem: 'guide', extension: 'md' },
      body: {
        type: 'root',
        children: [{ type: 'element', tag: 'img', props: { src: './hero.png' }, children: [] }]
      }
    })
    const snapshot = {
      version: 2,
      integrity: 'integrity',
      generatedAt: 1,
      documentIds: [document.id],
      documentSourceIds: ['content:docs:guide.md'],
      documents: [document]
    }
    const report = { version: 1, generatedAt: 1, integrity: 'integrity', findings: [] }
    mocks.getItem.mockImplementation(async (key: string) => key === 'snapshot.json' ? snapshot : report)

    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    await expect(handler(createTestEvent())).resolves.toEqual(expect.objectContaining({ documentCount: 1 }))

    expect(mocks.getItem).toHaveBeenCalledWith('validation.json')
    expect(mocks.sourceHasItem).not.toHaveBeenCalled()
    expect(mocks.setItem).not.toHaveBeenCalled()
  })
})
