import { describe, expect, test } from 'vitest'

describe('agent surface contracts', () => {
  test('validates agent section references and production site url', async () => {
    const { hasAgentSurface, validateAgentConfig } = await import('../../packages/content/src/module/agent-config')

    expect(hasAgentSurface({
      collections: {
        docs: { type: 'page' }
      }
    } as any)).toBe(false)
    expect(hasAgentSurface({
      collections: {
        docs: { type: 'page', agent: { markdown: true } }
      }
    } as any)).toBe(true)

    expect(() => validateAgentConfig({
      agent: {
        site: {
          title: 'Docs',
          description: 'Docs site.',
          url: 'https://example.test'
        },
        sections: [{ id: 'docs', title: 'Docs' }],
        pages: []
      },
      collections: {
        docs: { type: 'page', agent: { section: 'missing', markdown: true } }
      }
    } as any, { agent: { routes: true, prerender: true } } as any, { dev: false })).toThrow(
      /unknown Ginko agent section "missing"/
    )

    expect(() => validateAgentConfig({
      agent: {
        site: {
          title: 'Docs',
          description: 'Docs site.'
        },
        sections: [{ id: 'docs', title: 'Docs' }],
        pages: []
      },
      collections: {
        docs: { type: 'page', agent: { section: 'docs', markdown: true } }
      }
    } as any, { agent: { routes: true, prerender: true } } as any, { dev: false })).toThrow(
      /requires agent\.site\.url/
    )
  })

  test('parses markdown Accept headers and respects q=0', async () => {
    const { acceptsMarkdown } = await import('../../packages/content/src/runtime/server/agent-http')

    expect(acceptsMarkdown({ node: { req: { headers: { accept: 'text/markdown;q=0, text/html;q=1' } } } } as any)).toBe(false)
    expect(acceptsMarkdown({ node: { req: { headers: { accept: 'text/html, text/markdown;q=0.7' } } } } as any)).toBe(false)
    expect(acceptsMarkdown({ node: { req: { headers: { accept: '*/*;q=0.1' } } } } as any)).toBe(false)
    expect(acceptsMarkdown({ node: { req: { headers: { accept: 'text/markdown, text/html;q=0.5' } } } } as any)).toBe(true)
  })

  test('exports one canonical raw markdown route helper', async () => {
    const { agentRawPathForRoute, agentMarkdownPathForRoute } = await import('../../packages/content/src/features/agent/agent-paths')

    expect(agentRawPathForRoute('/')).toBe('/raw/index.md')
    expect(agentRawPathForRoute('/docs/intro/')).toBe('/raw/docs/intro.md')
    expect(agentMarkdownPathForRoute('/docs/intro/')).toBe('/docs/intro/index.md')
  })

  test('detects unsafe agent route paths before markdown resolution', async () => {
    const { isUnsafeAgentRoutePath, normalizeAgentRoutePath } = await import('../../packages/content/src/features/agent/agent-paths')

    expect(isUnsafeAgentRoutePath('/docs/intro')).toBe(false)
    expect(isUnsafeAgentRoutePath('/docs//intro')).toBe(false)
    expect(normalizeAgentRoutePath('/docs//intro')).toBe('/docs/intro')
    expect(isUnsafeAgentRoutePath('/../secret')).toBe(true)
    expect(isUnsafeAgentRoutePath('/docs/%2e%2e/secret')).toBe(true)
    expect(isUnsafeAgentRoutePath('/docs/%252e%252e/secret')).toBe(true)
    expect(isUnsafeAgentRoutePath('/docs/%00secret')).toBe(true)
  })
})
