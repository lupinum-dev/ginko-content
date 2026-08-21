import { beforeEach, describe, expect, test, vi } from 'vitest'

const seoCalls: Array<Record<string, unknown>> = []
const createdErrors: Array<Record<string, unknown>> = []

vi.mock('#imports', () => ({
  createError: (input: Record<string, unknown>) => {
    createdErrors.push(input)
    return Object.assign(new Error(String(input.statusMessage)), input)
  },
  useSeoMeta: (meta: Record<string, unknown>) => {
    seoCalls.push(meta)
  },
  useRoute: () => ({ path: '/guide/missing' })
}))

const useContentPage = vi.fn()

vi.mock('../../packages/content/src/runtime/app/composables/use-content-page', () => ({
  useContentPage: (...args: unknown[]) => useContentPage(...args)
}))

const pageResult = (page: unknown, status = 'success') => ({
  page: { value: page },
  previous: { value: null },
  next: { value: null },
  status: { value: status },
  error: { value: undefined },
  refresh: async () => {}
})

const doc = {
  id: 'content:docs:guide.md',
  collection: 'docs',
  canonicalKey: 'docs/guide',
  locale: 'en',
  title: 'Guide',
  description: 'The guide',
  route: { resolvedPath: '/guide', alternates: [] },
  resolution: { requested: {}, resolved: { locale: 'en' }, usedFallback: false }
}

describe('defineContentPage', () => {
  beforeEach(() => {
    seoCalls.length = 0
    createdErrors.length = 0
    useContentPage.mockReset()
  })

  test('throws a fatal 404 when the query settles empty by default', async () => {
    useContentPage.mockResolvedValue(pageResult(null))

    const { defineContentPage } = await import('../../packages/content/src/runtime/app/composables/define-content-page')

    await expect(defineContentPage('docs' as never)).rejects.toMatchObject({
      statusCode: 404,
      fatal: true
    })
    expect(createdErrors[0]).toMatchObject({ statusCode: 404, statusMessage: 'Page not found' })
    expect(createdErrors[0].data).toMatchObject({ collection: 'docs', path: '/guide/missing' })
  })

  test('renders the not-found state when policy is render', async () => {
    useContentPage.mockResolvedValue(pageResult(null))

    const { defineContentPage } = await import('../../packages/content/src/runtime/app/composables/define-content-page')

    await expect(defineContentPage('docs' as never, { notFound: 'render' })).resolves.toMatchObject({
      page: { value: null }
    })
    expect(createdErrors).toHaveLength(0)
  })

  test('does not throw while a refetch is pending', async () => {
    useContentPage.mockResolvedValue(pageResult(null, 'pending'))

    const { defineContentPage } = await import('../../packages/content/src/runtime/app/composables/define-content-page')

    await expect(defineContentPage('docs' as never)).resolves.toBeDefined()
    expect(createdErrors).toHaveLength(0)
  })

  test('syncs document title and description to head by default', async () => {
    useContentPage.mockResolvedValue(pageResult(doc))

    const { defineContentPage } = await import('../../packages/content/src/runtime/app/composables/define-content-page')

    await defineContentPage('docs' as never)

    expect(seoCalls).toHaveLength(1)
    const meta = seoCalls[0] as Record<string, () => string | undefined>
    expect(meta.title()).toBe('Guide')
    expect(meta.description()).toBe('The guide')
    expect(meta.ogTitle()).toBe('Guide')
  })

  test('seo: false skips head mutation', async () => {
    useContentPage.mockResolvedValue(pageResult(doc))

    const { defineContentPage } = await import('../../packages/content/src/runtime/app/composables/define-content-page')

    await defineContentPage('docs' as never, { seo: false })

    expect(seoCalls).toHaveLength(0)
  })

  test('explicit seo overrides win over document values', async () => {
    useContentPage.mockResolvedValue(pageResult(doc))

    const { defineContentPage } = await import('../../packages/content/src/runtime/app/composables/define-content-page')

    await defineContentPage('docs' as never, { seo: { title: 'Custom', description: () => 'Dynamic' } })

    const meta = seoCalls[0] as Record<string, () => string | undefined>
    expect(meta.title()).toBe('Custom')
    expect(meta.description()).toBe('Dynamic')
  })

  test('forwards page options to useContentPage', async () => {
    useContentPage.mockResolvedValue(pageResult(doc))

    const { defineContentPage } = await import('../../packages/content/src/runtime/app/composables/define-content-page')

    await defineContentPage('docs' as never, { surround: true } as never)

    expect(useContentPage).toHaveBeenCalledWith('docs', { surround: true })
  })
})
