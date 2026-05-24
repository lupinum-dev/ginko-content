import { beforeEach, describe, expect, test } from 'vitest'
import { pagefindMocks } from '../../test/mock/pagefind'

describe('Pagefind index writer', () => {
  beforeEach(() => {
    pagefindMocks.addCustomRecord.mockReset()
    pagefindMocks.writeFiles.mockReset()
    pagefindMocks.addCustomRecord.mockResolvedValue({ errors: [] })
    pagefindMocks.writeFiles.mockResolvedValue({ errors: [] })
  })

  test('writes search records as custom Pagefind records with URL, locale, and metadata', async () => {
    const { writePagefindIndex } = await import('../../packages/content/src/runtime/server/pagefind')

    await writePagefindIndex([
      {
        id: '/de/docs/search#setup',
        path: '/de/docs/search',
        title: 'Search Setup',
        excerpt: 'Configure search',
        content: 'Install Pagefind and generate records',
        headings: ['Docs', 'Search'],
        anchor: 'setup',
        locale: 'de'
      }
    ], '/tmp/ginko-pagefind')

    expect(pagefindMocks.addCustomRecord).toHaveBeenCalledWith({
      url: '/de/docs/search#setup',
      content: 'Search Setup\nDocs\nSearch\nInstall Pagefind and generate records',
      language: 'de',
      meta: {
        title: 'Search Setup',
        excerpt: 'Configure search',
        locale: 'de',
        anchor: 'setup',
        path: '/de/docs/search'
      }
    })
    expect(pagefindMocks.writeFiles).toHaveBeenCalledWith({ outputPath: '/tmp/ginko-pagefind' })
  })

  test('fails loudly when Pagefind rejects a record', async () => {
    const { writePagefindIndex } = await import('../../packages/content/src/runtime/server/pagefind')
    pagefindMocks.addCustomRecord.mockResolvedValueOnce({ errors: ['bad record'] })

    await expect(writePagefindIndex([
      {
        id: '/docs/search',
        path: '/docs/search',
        title: 'Search',
        excerpt: '',
        content: 'Search content',
        headings: []
      }
    ], '/tmp/ginko-pagefind')).rejects.toThrow('Failed to add Pagefind record for /docs/search: bad record')
    expect(pagefindMocks.writeFiles).not.toHaveBeenCalled()
  })
})
