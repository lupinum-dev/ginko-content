import { afterEach, describe, expect, test, vi } from 'vitest'
import { transformContent } from '../../packages/content/src/parsers'

describe('transformContent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('stores unsupported content as a missing-document stub', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(transformContent('content:notes/file.unsupported', 'raw text')).resolves.toEqual({
      id: 'content:notes/file.unsupported',
      body: null,
      // The missing discriminant keeps unsupported-extension stubs out of the
      // snapshot corpus without excluding body-less real documents.
      missing: true
    })
    expect(warn).toHaveBeenCalledWith('.unsupported files are not supported, "content:notes/file.unsupported" storing body as null')
  })

  test('warns on reserved frontmatter keys and keeps the system value authoritative', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await transformContent(
      'content:en:guide:intro.md',
      '---\nid: user-supplied-id\npath: /custom-route\n---\n# Hello',
      { pathMeta: { locales: ['en'], defaultLocale: 'en' } }
    ) as Record<string, unknown>

    // System values win over the user's reserved frontmatter.
    expect(result.id).toBe('content:en:guide:intro.md')
    expect(result.path).toBe('/guide/intro')

    const messages = warn.mock.calls.map(call => String(call[0]))
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('reserved frontmatter key "id"'),
      expect.stringContaining('reserved frontmatter key "path"')
    ]))
    // The `id` warning points authors at `ref`.
    expect(messages.find(message => message.includes('"id"'))).toContain('ref')
  })
})
