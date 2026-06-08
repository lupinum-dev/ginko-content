// @vitest-environment node

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { assertNoPrivateContentLeaks, readGeneratedArtifact } from '../helpers/generated-artifacts'
import { buildProductionFixture } from '../helpers/production-fixture'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-agent-output')

describe('agent output fixture', () => {
  test('generates custom serialized raw markdown and LLM output without private leaks', async () => {
    const fixture = await buildProductionFixture(fixtureDir)
    const enRaw = await readGeneratedArtifact(fixture.publicDir, 'raw/docs/agent-components.md')
    const deRaw = await readGeneratedArtifact(fixture.publicDir, 'raw/de/dokumentation/agent-komponenten.md')
    const llms = await readGeneratedArtifact(fixture.publicDir, 'llms.txt')
    const deLlms = await readGeneratedArtifact(fixture.publicDir, 'de/llms.txt')
    const llmsFull = await readGeneratedArtifact(fixture.publicDir, 'llms-full.txt')
    const deLlmsFull = await readGeneratedArtifact(fixture.publicDir, 'de/llms-full.txt')

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

    assertNoPrivateContentLeaks([
      { path: 'raw/docs/agent-components.md', text: enRaw },
      { path: 'raw/de/dokumentation/agent-komponenten.md', text: deRaw },
      { path: 'llms.txt', text: llms },
      { path: 'de/llms.txt', text: deLlms },
      { path: 'llms-full.txt', text: llmsFull },
      { path: 'de/llms-full.txt', text: deLlmsFull }
    ], ['Draft Secret', 'Partial Note', 'Private Record', 'do-not-leak'])
  }, 240000)
})
