// @vitest-environment node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  assertNoLocalOrigins,
  assertNoPrivateContentLeaks,
  assertNoRepeatedLocalePrefixes,
  listGeneratedTextArtifacts,
  readGeneratedArtifact,
  readSearchIndex
} from '../helpers/generated-artifacts'
import { buildProductionFixture } from '../helpers/production-fixture'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-i18n')

describe('generated output smoke', () => {
  test('i18n fixture emits stable localized HTML, sitemap, search, and agent markdown artifacts', async () => {
    const fixture = await buildProductionFixture(fixtureDir)
    const outputPublicDir = fixture.publicDir
    const textArtifacts = await listGeneratedTextArtifacts(outputPublicDir)

    expect(existsSync(resolve(outputPublicDir, 'guide/getting-started/index.html'))).toBe(true)
    expect(existsSync(resolve(outputPublicDir, 'de/leitfaden/erste-schritte/index.html'))).toBe(true)
    expect(await readGeneratedArtifact(outputPublicDir, 'guide/getting-started/index.html')).toContain('Getting Started')
    expect(await readGeneratedArtifact(outputPublicDir, 'de/leitfaden/erste-schritte/index.html')).toContain('Einstieg')

    const searchIndex = await readSearchIndex(outputPublicDir)
    expect(searchIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Getting Started', path: '/guide/getting-started', locale: 'en' }),
      expect.objectContaining({ title: 'Einstieg', path: '/de/leitfaden/erste-schritte', locale: 'de' })
    ]))
    expect(JSON.stringify(searchIndex)).not.toContain('/authors/evan')
    expect(JSON.stringify(searchIndex)).not.toContain('Draft Roadmap')
    expect(JSON.stringify(searchIndex)).not.toContain('Internal Note')

    const sitemapText = [
      await readGeneratedArtifact(outputPublicDir, '__sitemap__/en-US.xml'),
      await readGeneratedArtifact(outputPublicDir, '__sitemap__/de-DE.xml')
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

    const enMarkdown = await readGeneratedArtifact(outputPublicDir, 'raw/guide/getting-started.md')
    const deMarkdown = await readGeneratedArtifact(outputPublicDir, 'raw/de/leitfaden/erste-schritte.md')
    expect(existsSync(resolve(outputPublicDir, 'guide/getting-started/index.md'))).toBe(false)
    expect(existsSync(resolve(outputPublicDir, 'de/leitfaden/erste-schritte/index.md'))).toBe(false)
    expect(enMarkdown).toContain('# Getting Started')
    expect(deMarkdown).toContain('# Einstieg')
    expect(enMarkdown).toContain('/raw/guide/$guide-advanced.md#deep-dive')
    expect(deMarkdown).toContain('/raw/de/leitfaden/$guide-advanced.md#deep-dive')
    expect(enMarkdown).not.toContain('/index.md')
    expect(deMarkdown).not.toContain('/index.md')

    const llms = await readGeneratedArtifact(outputPublicDir, 'llms.txt')
    const deLlms = await readGeneratedArtifact(outputPublicDir, 'de/llms.txt')
    const llmsFull = await readGeneratedArtifact(outputPublicDir, 'llms-full.txt')
    expect(llms).toContain('/raw/guide/getting-started.md')
    expect(deLlms).toContain('/raw/de/leitfaden/erste-schritte.md')
    expect(llmsFull).toContain('# Getting Started')
    expect(llmsFull).toContain('# Contact')
    expect(llmsFull).not.toContain('Draft Roadmap')
    expect(llmsFull).not.toContain('Internal Note')
    expect(llmsFull).not.toContain('/index.md')

    assertNoLocalOrigins(textArtifacts)
    assertNoRepeatedLocalePrefixes(textArtifacts, ['de', 'en'])
    assertNoPrivateContentLeaks(textArtifacts, ['Draft Roadmap', 'Internal Note'])
  }, 240000)
})
