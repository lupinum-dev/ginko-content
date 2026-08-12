import { describe, expect, test } from 'vitest'
import type { MarkdownOptions } from '../../packages/content/src/types/content'
import { createComarkParser, parseComark } from '../../packages/content/src/core/markdown/parse-comark'
import { getConfiguredComarkParser } from '../../packages/content/src/parsers/markdown'

const options = (): MarkdownOptions => ({
  plugins: [{ name: 'toc', options: { depth: 3 } }],
  tags: {},
  anchorLinks: { depth: 4, exclude: [1] },
  image: 'auto'
})

describe('configured Comark parser lifecycle', () => {
  test('compiles once per resolved option identity, including concurrent callers', async () => {
    const owner = options()
    const [first, second] = await Promise.all([
      getConfiguredComarkParser(owner),
      getConfiguredComarkParser(owner)
    ])

    expect(second).toBe(first)
    expect(await second('# Two\n\n## Child')).toEqual(await first('# Two\n\n## Child'))
  })

  test('does not share a parser across distinct configuration lifecycles', async () => {
    const first = await getConfiguredComarkParser(options())
    const second = await getConfiguredComarkParser(options())

    expect(second).not.toBe(first)
  })

  test('keeps concurrent configured and baseline parses isolated', async () => {
    const sources = Array.from({ length: 20 }, (_, index) =>
      `# Document ${index}\n\n## Section\n\nBody **${index}**.`
    )
    const configured = await getConfiguredComarkParser(options())

    const [configuredConcurrent, baselineConcurrent] = await Promise.all([
      Promise.all(sources.map(source => configured(source))),
      Promise.all(sources.map(source => parseComark(source)))
    ])
    const configuredIsolated = await Promise.all(sources.map(async (source) =>
      await (await getConfiguredComarkParser(options()))(source)
    ))
    const baselineIsolated = await Promise.all(sources.map(async (source) =>
      await createComarkParser()(source)
    ))

    expect(configuredConcurrent).toEqual(configuredIsolated)
    expect(baselineConcurrent).toEqual(baselineIsolated)
  })

  test('evicts a rejected construction so a corrected profile can initialize', async () => {
    const owner = options()
    owner.plugins = [{ name: 'missing-plugin', options: {} }]

    await expect(getConfiguredComarkParser(owner)).rejects.toThrow(/not present in the generated Nuxt plugin registry/)
    owner.plugins = [{ name: 'toc', options: { depth: 3 } }]

    await expect((await getConfiguredComarkParser(owner))('# Corrected')).resolves.toMatchObject({
      nodes: expect.any(Array)
    })
  })
})
