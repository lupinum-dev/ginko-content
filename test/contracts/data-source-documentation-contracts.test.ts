import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'

const guidePath = 'docs/content/docs/4.guides/13.data-source-adapters.md'
const examplePath = 'test/fixtures/typecheck/types/data-source-adapter.ts'
const apiReferencePath = 'docs/content/docs/5.reference/11.package-exports.md'
const normalizeLineEndings = (value: string) => value.replace(/\r\n?/g, '\n')

describe('data-source adapter documentation', () => {
  test('publishes one complete adapter-author guide', async () => {
    const [guide, example] = await Promise.all([
      readFile(guidePath, 'utf8'),
      readFile(examplePath, 'utf8'),
    ])

    const normalizedGuide = guide.toLowerCase().replace(/\s+/g, ' ')
    for (const required of [
      '@lupinum/ginko-content/data-source',
      'verified context',
      'fixed-shape',
      'ginko portability codec',
      'fixed portable baseline',
      'persistence, authorization, byte streaming, and retry policy',
      'level 1',
      'level 2',
      'bindcontentprovider',
      'without workspace resolution',
      'production checklist',
    ]) {
      expect(normalizedGuide, required).toContain(required)
    }

    expect(normalizeLineEndings(guide)).toContain(
      `\`\`\`ts [data-source-adapter.ts]\n${normalizeLineEndings(example).trim()}\n\`\`\``
    )
  })

  test('publishes generated manifest export facts and links the public guide', async () => {
    const [apiReference, manifestSource] = await Promise.all([
      readFile(apiReferencePath, 'utf8'),
      readFile('packages/content/package.json', 'utf8'),
    ])
    const manifest = JSON.parse(manifestSource) as { name: string, exports: Record<string, unknown> }

    expect(apiReference).toContain('| `@lupinum/ginko-content/data-source` |')
    expect(apiReference).toContain('| `@lupinum/ginko-content/testing/data-source-contract` |')
    expect(apiReference).toContain('`createContentDataSourceError`')
    expect(apiReference).toContain('`ContentDataSourceErrorCode`')
    expect(apiReference).toContain('[data-source adapter guide](/docs/guides/data-source-adapters)')

    for (const subpath of Object.keys(manifest.exports)) {
      const specifier = subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`
      expect(apiReference.split(`| \`${specifier}\` |`)).toHaveLength(2)
    }
  })
})
