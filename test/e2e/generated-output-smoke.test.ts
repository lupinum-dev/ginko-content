// @vitest-environment node

import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { startFixtureServer } from '../helpers/fixture-server'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-i18n')
const outputPublicDir = resolve(fixtureDir, '.output/public')
const localOriginPattern = /http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])|https?:\/\/[^/\s"'<>]*localhost/i
const repeatedLocalePrefixPattern = /\/(?:de|en)\/(?:de|en)\//

async function readOutputFile (relativePath: string) {
  return readFile(resolve(outputPublicDir, relativePath), 'utf8')
}

async function listOutputFiles (directory = outputPublicDir): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      return listOutputFiles(path)
    }

    return [path.slice(outputPublicDir.length + 1)]
  }))

  return files.flat()
}

describe('generated output smoke', () => {
  test('i18n fixture emits stable localized HTML, sitemap, search, and agent markdown artifacts', async () => {
    const server = await startFixtureServer(fixtureDir)
    try {
      const outputFiles = await listOutputFiles()
      const textArtifactPaths = outputFiles.filter(path => /\.(?:html|xml|json|txt|md)$/.test(path))
      const textArtifacts = await Promise.all(textArtifactPaths.map(async path => ({
        path,
        text: await readOutputFile(path)
      })))

      expect(existsSync(resolve(outputPublicDir, 'guide/getting-started/index.html'))).toBe(true)
      expect(existsSync(resolve(outputPublicDir, 'de/leitfaden/erste-schritte/index.html'))).toBe(true)
      expect(await readOutputFile('guide/getting-started/index.html')).toContain('Getting Started')
      expect(await readOutputFile('de/leitfaden/erste-schritte/index.html')).toContain('Einstieg')

      const searchIndex = JSON.parse(await readOutputFile('api/_content/search/index.json')) as Array<Record<string, unknown>>
      expect(searchIndex).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: 'Getting Started', path: '/guide/getting-started', locale: 'en' }),
        expect.objectContaining({ title: 'Einstieg', path: '/de/leitfaden/erste-schritte', locale: 'de' })
      ]))
      expect(JSON.stringify(searchIndex)).not.toContain('/authors/evan')
      expect(JSON.stringify(searchIndex)).not.toContain('Draft Roadmap')
      expect(JSON.stringify(searchIndex)).not.toContain('Internal Note')

      const sitemapText = [
        await readOutputFile('__sitemap__/en-US.xml'),
        await readOutputFile('__sitemap__/de-DE.xml')
      ].join('\n')
      expect(sitemapText).toContain('https://ginko-content.example.test/guide/getting-started')
      expect(sitemapText).toContain('https://ginko-content.example.test/de/leitfaden/erste-schritte')
      expect(sitemapText).toContain('hreflang="en-US"')
      expect(sitemapText).toContain('hreflang="de-DE"')
      expect(sitemapText).not.toContain('/authors/evan')
      expect(sitemapText).not.toContain('/guide/draft-roadmap')
      expect(sitemapText).not.toContain('/de/leitfaden/entwurf')
      expect(sitemapText).not.toContain('/guide/internal-note')
      expect(sitemapText).not.toContain('/de/leitfaden/interne-notiz')

      const enRaw = await readOutputFile('raw/guide/getting-started.md')
      const enIndexMarkdown = await readOutputFile('guide/getting-started/index.md')
      const deRaw = await readOutputFile('raw/de/leitfaden/erste-schritte.md')
      const deIndexMarkdown = await readOutputFile('de/leitfaden/erste-schritte/index.md')
      expect(enRaw).toBe(enIndexMarkdown)
      expect(deRaw).toBe(deIndexMarkdown)
      expect(enRaw).toContain('# Getting Started')
      expect(deRaw).toContain('# Einstieg')

      const llms = await readOutputFile('llms.txt')
      const deLlms = await readOutputFile('de/llms.txt')
      const llmsFull = await readOutputFile('llms-full.txt')
      expect(llms).toContain('/raw/guide/getting-started.md')
      expect(deLlms).toContain('/raw/de/leitfaden/erste-schritte.md')
      expect(llmsFull).toContain('# Getting Started')
      expect(llmsFull).toContain('# Contact')
      expect(llmsFull).not.toContain('Draft Roadmap')
      expect(llmsFull).not.toContain('Internal Note')

      for (const artifact of textArtifacts) {
        expect(artifact.text, `${artifact.path} should not leak local origins`).not.toMatch(localOriginPattern)
        expect(artifact.text, `${artifact.path} should not contain repeated locale prefixes`).not.toMatch(repeatedLocalePrefixPattern)
      }
    } finally {
      await server.stop()
    }
  }, 240000)
})
