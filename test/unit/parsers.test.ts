import { afterEach, describe, expect, test, vi } from 'vitest'
import { transformContent } from '../../packages/content/src/parsers'
import pathMeta from '../../packages/content/src/parsers/path-meta'
import { makeIgnored } from '../../packages/content/src/core/content/ignore'

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
      '---\nid: user-supplied-id\npath: /custom-route\ndir: user-dir\n---\n# Hello',
      { pathMeta: { locales: ['en'], defaultLocale: 'en' } }
    ) as Record<string, unknown>

    // System values win over the user's reserved frontmatter.
    expect(result.id).toBe('content:en:guide:intro.md')
    expect(result.path).toBe('/guide/intro')
    // `dir` is reserved: the query executor stamps the directory config onto
    // results as a top-level `dir`, so an authored `dir:` is stripped rather
    // than left to be silently clobbered. Before `dir` was reserved this
    // survived as `result.dir === 'user-dir'`.
    expect(result.dir).toBeUndefined()

    const messages = warn.mock.calls.map(call => String(call[0]))
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('reserved frontmatter key "id"'),
      expect.stringContaining('reserved frontmatter key "path"'),
      expect.stringContaining('reserved frontmatter key "dir"')
    ]))
    // The `id` warning points authors at `ref`.
    expect(messages.find(message => message.includes('"id"'))).toContain('ref')
  })
})

describe('content parsing metadata', () => {
  test('does not ignore .navigation.yml files', () => {
    const ignored = makeIgnored([])
    expect(ignored('content:guide:.navigation.yml')).toBe(false)
  })

  test('marks .navigation.yml as folder metadata', () => {
    const transformed = pathMeta.transform!(
      { id: 'content:guide:.navigation.yml', body: {} as any },
      { locales: [], defaultLocale: 'en' }
    )

    expect(transformed.navigationFile).toBe(true)
    expect(transformed.partial).toBe(true)
    expect(transformed).not.toHaveProperty('path')
    expect(transformed).not.toHaveProperty('canonicalKey')
  })

})
