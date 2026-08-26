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
          whenToUse: 'Use this site for the Docs product.'
        },
        sections: [{ id: 'docs', title: 'Docs' }],
        pages: []
      },
      collections: {
        docs: { type: 'page', agent: { section: 'missing', markdown: true } }
      }
    } as any, { agent: { routes: true, delivery: 'static' } } as any, { dev: false, siteUrl: 'https://example.test' })).toThrow(
      /unknown Ginko agent section "missing"/
    )

    expect(() => validateAgentConfig({
      agent: {
        site: {
          title: 'Docs',
          description: 'Docs site.',
          whenToUse: 'Use this site for the Docs product.'
        },
        sections: [{ id: 'docs', title: 'Docs' }],
        pages: []
      },
      collections: {
        docs: { type: 'page', agent: { section: 'docs', markdown: true } }
      }
    } as any, { agent: { routes: true, delivery: 'static' } } as any, { dev: false })).toThrow(
      /requires the canonical site URL/
    )

    expect(() => validateAgentConfig({
      agent: {
        site: {
          title: 'Docs',
          description: 'Docs site.',
          whenToUse: 'Use this site for the Docs product.'
        }
      },
      collections: {}
    } as Parameters<typeof validateAgentConfig>[0], {
      agent: { routes: true, delivery: 'runtime' }
    } as Parameters<typeof validateAgentConfig>[1], { dev: false })).toThrow(
      /requires the canonical site URL/
    )

    expect(() => validateAgentConfig({
      collections: {
        docs: { type: 'page', agent: { markdown: true } }
      }
    } as any, { agent: { routes: true } } as any, { dev: true })).toThrow(
      /requires agent\.site/
    )

    expect(() => validateAgentConfig({
      agent: {
        site: { title: 'Docs', description: 'Docs site.', whenToUse: '  ' }
      },
      collections: {}
    } as any, { agent: { routes: true } } as any, { dev: true })).toThrow(
      /agent\.site\.whenToUse must contain non-empty text/
    )
  })

  test('parses markdown Accept headers and respects q=0', async () => {
    const { acceptsMarkdown } = await import('../../packages/content/src/runtime/server/agent-http')
    const event = (accept: string) => ({
      node: { req: { headers: { accept } } }
    }) as Parameters<typeof acceptsMarkdown>[0]

    expect(acceptsMarkdown(event('text/markdown;q=0, text/html;q=1'))).toBe(false)
    expect(acceptsMarkdown(event('text/html, text/markdown;q=0.7'))).toBe(false)
    expect(acceptsMarkdown(event('*/*;q=0.1'))).toBe(false)
    expect(acceptsMarkdown(event('text/markdown, text/html;q=0.5'))).toBe(true)
    expect(acceptsMarkdown(event('*/*;q=1, text/markdown;q=0.5'))).toBe(false)
    expect(acceptsMarkdown(event('text/*;q=0.8, text/markdown;q=0.5'))).toBe(false)
    expect(acceptsMarkdown(event('text/html;q=0.4, text/markdown;q=2'))).toBe(false)
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
