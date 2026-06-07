import { afterEach, describe, expect, test, vi } from 'vitest'
import { transformContent } from '../../packages/content/src/parsers'

describe('transformContent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('stores unsupported content bodies as null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(transformContent('content:notes/file.unsupported', 'raw text')).resolves.toEqual({
      _id: 'content:notes/file.unsupported',
      body: null
    })
    expect(warn).toHaveBeenCalledWith('.unsupported files are not supported, "content:notes/file.unsupported" storing body as null')
  })
})
