// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { startFixtureServer } from '../helpers/fixture-server'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-agent-output')
const outputPublicDir = resolve(fixtureDir, '.output/public')

async function readOutputFile (relativePath: string) {
  return readFile(resolve(outputPublicDir, relativePath), 'utf8')
}

describe('agent output fixture', () => {
  test('generates custom serialized raw markdown and LLM output without private leaks', async () => {
    const server = await startFixtureServer(fixtureDir)
    try {
      const enRaw = await readOutputFile('raw/docs/agent-components.md')
      const deRaw = await readOutputFile('raw/de/dokumentation/agent-komponenten.md')
      const llms = await readOutputFile('llms.txt')
      const deLlms = await readOutputFile('de/llms.txt')
      const llmsFull = await readOutputFile('llms-full.txt')
      const deLlmsFull = await readOutputFile('de/llms-full.txt')

      expect(enRaw).toBe(await readOutputFile('docs/agent-components/index.md'))
      expect(deRaw).toBe(await readOutputFile('de/dokumentation/agent-komponenten/index.md'))

      expect(enRaw).toContain('Fixture callout: Serializer contract')
      expect(enRaw).toContain('<card title="Stable Card" to="/docs/agent-components">')
      expect(enRaw).toContain('<gallery layout="rows" caption="Fixture gallery">')
      expect(enRaw).toContain('<chart>')
      expect(enRaw).toContain('"values": [')
      expect(enRaw).toContain('Consent-gated embed. Category: video.')
      expect(enRaw).toContain('<unknown-widget>')
      expect(enRaw).toContain('Unknown component body.')

      expect(deRaw).toContain('Fixture callout: Serializer-Vertrag')
      expect(deRaw).toContain('<card title="Stabile Karte" to="/de/dokumentation/agent-komponenten">')
      expect(deRaw).toContain('<gallery layout="rows" caption="Fixture-Galerie">')
      expect(deRaw).toContain('<chart>')
      expect(deRaw).toContain('Consent-gated embed. Category: video.')

      expect(llms).toContain('/raw/docs/agent-components.md')
      expect(llms).toContain('/raw/services/consulting.md')
      expect(llms).toContain('/raw/legal.md')
      expect(deLlms).toContain('/raw/de/dokumentation/agent-komponenten.md')
      expect(deLlms).toContain('/raw/de/leistungen/beratung.md')
      expect(deLlms).toContain('/raw/de/rechtliches.md')

      expect(llmsFull).toContain('# Agent Components')
      expect(llmsFull).toContain('# Consulting')
      expect(llmsFull).toContain('# Legal Notice')
      expect(llmsFull).toContain('Fixture callout: Serializer contract')
      expect(deLlmsFull).toContain('# Agent-Komponenten')
      expect(deLlmsFull).toContain('# Beratung')
      expect(deLlmsFull).toContain('# Impressum')
      expect(deLlmsFull).toContain('Fixture callout: Serializer-Vertrag')

      for (const artifact of [enRaw, deRaw, llms, deLlms, llmsFull, deLlmsFull]) {
        expect(artifact).not.toContain('Draft Secret')
        expect(artifact).not.toContain('Partial Note')
        expect(artifact).not.toContain('Private Record')
        expect(artifact).not.toContain('do-not-leak')
      }
    } finally {
      await server.stop()
    }
  }, 240000)
})
