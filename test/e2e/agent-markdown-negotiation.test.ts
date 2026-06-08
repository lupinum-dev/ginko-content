// @vitest-environment node

import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { startFixtureServer } from '../helpers/fixture-server'
import { readGeneratedArtifact } from '../helpers/generated-artifacts'
import { buildProductionFixture } from '../helpers/production-fixture'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const agentFixtureDir = resolve(rootDir, 'playground/ginko-agent-output')
const disabledFixtureDir = resolve(rootDir, 'playground/ginko-agent-disabled')

async function requestStatus (baseURL: string, path: string) {
  const url = new URL(baseURL)
  return await new Promise<number>((resolve, reject) => {
    const req = request({
      hostname: url.hostname,
      port: url.port,
      method: 'GET',
      path
    }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode || 0))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('agent markdown negotiation', () => {
  test('serves HTML by default and markdown for Accept negotiation on a dynamic route', async () => {
    const server = await startFixtureServer(agentFixtureDir)
    try {
      const htmlResponse = await fetch(`${server.baseURL}/ssr-only`)
      const html = await htmlResponse.text()

      expect(htmlResponse.status).toBe(200)
      expect(htmlResponse.headers.get('content-type')).toContain('text/html')
      expect(html).toContain('SSR Only HTML')
      expect(html).not.toContain('This markdown is served only when the request negotiates markdown.')

      const linkHeader = htmlResponse.headers.get('link') || ''
      expect(linkHeader).toContain('/raw/ssr-only.md')
      expect(linkHeader).toContain('/ssr-only/index.md')
      expect(linkHeader).toContain('/llms.txt')
      expect(htmlResponse.headers.get('content-signal')).toContain('ai-train=no')

      const markdownResponse = await fetch(`${server.baseURL}/ssr-only`, {
        headers: { Accept: 'text/markdown' }
      })
      const markdown = await markdownResponse.text()

      expect(markdownResponse.status).toBe(200)
      expect(markdownResponse.headers.get('content-type')).toContain('text/markdown')
      expect(markdownResponse.headers.get('vary')?.toLowerCase()).toContain('accept')
      expect(markdown).toContain('# SSR Only')
      expect(markdown).toContain('This markdown is served only when the request negotiates markdown.')
      expect(markdown).not.toContain('SSR Only HTML')

      const explicitMarkdownResponse = await fetch(`${server.baseURL}/ssr-only/index.md`)
      expect(explicitMarkdownResponse.status).toBe(200)
      expect(explicitMarkdownResponse.headers.get('content-type')).toContain('text/markdown')
      expect(await explicitMarkdownResponse.text()).toContain('# SSR Only')

      const rawMarkdownResponse = await fetch(`${server.baseURL}/raw/ssr-only.md`)
      expect(rawMarkdownResponse.status).toBe(200)
      expect(rawMarkdownResponse.headers.get('content-type')).toContain('text/markdown')
      expect(await rawMarkdownResponse.text()).toContain('# SSR Only')
    } finally {
      await server.stop()
    }
  }, 240000)

  test('keeps static output on explicit markdown files instead of same-URL negotiation', async () => {
    const fixture = await buildProductionFixture(agentFixtureDir)

    expect(existsSync(resolve(fixture.publicDir, 'docs/agent-components/index.html'))).toBe(true)
    expect(existsSync(resolve(fixture.publicDir, 'docs/agent-components/index.md'))).toBe(true)
    expect(await readGeneratedArtifact(fixture.publicDir, 'docs/agent-components/index.md')).toBe(
      await readGeneratedArtifact(fixture.publicDir, 'raw/docs/agent-components.md')
    )
  }, 240000)

  test('rejects unknown explicit markdown routes and disabled agent markdown routes', async () => {
    const agentServer = await startFixtureServer(agentFixtureDir)
    try {
      const unknownRaw = await fetch(`${agentServer.baseURL}/raw/not-found.md`)
      expect(unknownRaw.status).toBe(404)

      const unknownNegotiated = await fetch(`${agentServer.baseURL}/not-found`, {
        headers: { Accept: 'text/markdown' }
      })
      expect(unknownNegotiated.status).toBe(200)
      expect(unknownNegotiated.headers.get('content-type')).toContain('text/html')
      expect(await unknownNegotiated.text()).not.toContain('# Not Found')
    } finally {
      await agentServer.stop()
    }

    const disabledServer = await startFixtureServer(disabledFixtureDir)
    try {
      const disabledRaw = await fetch(`${disabledServer.baseURL}/raw/index.md`)
      expect(disabledRaw.status).toBe(404)

      const disabledNegotiated = await fetch(`${disabledServer.baseURL}/`, {
        headers: { Accept: 'text/markdown' }
      })
      expect(disabledNegotiated.status).toBe(200)
      expect(disabledNegotiated.headers.get('content-type')).toContain('text/html')
      expect(await disabledNegotiated.text()).toContain('Agent Disabled HTML')
    } finally {
      await disabledServer.stop()
    }
  }, 240000)

  test('rejects traversal attempts and normalizes repeated slashes on explicit markdown routes', async () => {
    const server = await startFixtureServer(agentFixtureDir)
    try {
      for (const path of [
        '/raw/%2e%2e/secret.md',
        '/raw/%252e%252e/secret.md',
        '/raw/docs/%00secret.md'
      ]) {
        await expect(requestStatus(server.baseURL, path), path).resolves.toBe(400)
      }

      const normalizedRaw = await fetch(`${server.baseURL}/raw//docs//agent-components.md`)
      expect(normalizedRaw.status).toBe(200)
      expect(await normalizedRaw.text()).toContain('# Agent Components')
    } finally {
      await server.stop()
    }
  }, 240000)
})
