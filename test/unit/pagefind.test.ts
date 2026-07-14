import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    const outputPath = await mkdtemp(join(tmpdir(), 'ginko-pagefind-'))

    await writePagefindIndex([
      {
        id: '/de/docs/search#setup',
        collection: 'docs',
        path: '/de/docs/search',
        title: 'Search Setup',
        excerpt: 'Configure search',
        content: 'Install Pagefind and generate records',
        headings: ['Docs', 'Search'],
        anchor: 'setup',
        locale: 'de'
      }
    ], outputPath, 'de')

    expect(pagefindMocks.addCustomRecord).toHaveBeenCalledWith({
      url: '/de/docs/search#setup',
      content: 'Search Setup\nDocs\nSearch\nInstall Pagefind and generate records',
      language: 'de',
      meta: {
        title: 'Search Setup',
        excerpt: 'Configure search',
        collection: 'docs',
        locale: 'de',
        anchor: 'setup',
        path: '/de/docs/search'
      },
      filters: {
        locale: ['de']
      }
    })
    expect(pagefindMocks.writeFiles).toHaveBeenCalledWith({ outputPath })
    await expect(readFile(join(outputPath, 'ginko-locales.json'), 'utf8')).resolves.toBe(`${JSON.stringify({
      version: 1,
      defaultLocale: 'de',
      indexes: { de: 'pagefind.js' }
    }, null, 2)}\n`)
    await rm(outputPath, { recursive: true, force: true })
  })

  test('writes non-default locales to subdirectories and assigns missing locales to the configured default', async () => {
    const { writePagefindIndex } = await import('../../packages/content/src/runtime/server/pagefind')
    const outputPath = await mkdtemp(join(tmpdir(), 'ginko-pagefind-'))

    await writePagefindIndex([
      { id: '/start', collection: 'docs', path: '/start', title: 'Start', excerpt: '', content: 'Start', headings: [] },
      { id: '/en/start', collection: 'docs', path: '/en/start', title: 'Start', excerpt: '', content: 'Start', headings: [], locale: 'en' }
    ], outputPath, 'de')

    expect(pagefindMocks.writeFiles).toHaveBeenNthCalledWith(1, { outputPath })
    expect(pagefindMocks.writeFiles).toHaveBeenNthCalledWith(2, { outputPath: join(outputPath, 'en') })
    expect(pagefindMocks.addCustomRecord).toHaveBeenNthCalledWith(1, expect.objectContaining({ language: 'de', filters: { locale: ['de'] } }))
    await rm(outputPath, { recursive: true, force: true })
  })

  test('always writes the compatibility index for the configured default locale', async () => {
    const { writePagefindIndex } = await import('../../packages/content/src/runtime/server/pagefind')
    const outputPath = await mkdtemp(join(tmpdir(), 'ginko-pagefind-'))

    await writePagefindIndex([
      { id: '/de/start', collection: 'docs', path: '/de/start', title: 'Start', excerpt: '', content: 'Start', headings: [], locale: 'de' }
    ], outputPath, 'en')

    expect(pagefindMocks.writeFiles).toHaveBeenNthCalledWith(1, { outputPath })
    expect(pagefindMocks.writeFiles).toHaveBeenNthCalledWith(2, { outputPath: join(outputPath, 'de') })
    await expect(readFile(join(outputPath, 'ginko-locales.json'), 'utf8')).resolves.toContain('"en": "pagefind.js"')
    await rm(outputPath, { recursive: true, force: true })
  })

  test('rejects locale path traversal before creating or writing an index', async () => {
    const { writePagefindIndex } = await import('../../packages/content/src/runtime/server/pagefind')
    const outputPath = await mkdtemp(join(tmpdir(), 'ginko-pagefind-'))

    await expect(writePagefindIndex([], outputPath, '../outside')).rejects.toThrow(/locale/i)
    await expect(writePagefindIndex([
      { id: '/escape', collection: 'docs', path: '/escape', title: 'Escape', excerpt: '', content: 'Escape', headings: [], locale: 'de/../../outside' }
    ], outputPath, 'en')).rejects.toThrow(/locale/i)

    expect(pagefindMocks.addCustomRecord).not.toHaveBeenCalled()
    expect(pagefindMocks.writeFiles).not.toHaveBeenCalled()
    await rm(outputPath, { recursive: true, force: true })
  })

  test('fails loudly when Pagefind rejects a record', async () => {
    const { writePagefindIndex } = await import('../../packages/content/src/runtime/server/pagefind')
    pagefindMocks.addCustomRecord.mockResolvedValueOnce({ errors: ['bad record'] })

    await expect(writePagefindIndex([
      {
        id: '/docs/search',
        collection: 'docs',
        path: '/docs/search',
        title: 'Search',
        excerpt: '',
        content: 'Search content',
        headings: []
      }
    ], '/tmp/ginko-pagefind', 'en')).rejects.toThrow('Failed to add Pagefind record for /docs/search: bad record')
    expect(pagefindMocks.writeFiles).not.toHaveBeenCalled()
  })
})
