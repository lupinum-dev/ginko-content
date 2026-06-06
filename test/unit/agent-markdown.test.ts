import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ParsedContent } from '../../packages/content/src/types/content'

const markdownBody = (children: NonNullable<ParsedContent['body']>['children']): ParsedContent['body'] => ({
  type: 'root',
  children
})

describe('agent markdown', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('exposes typed built-in metadata field helpers', async () => {
    const { agentMetadataFields, defineAgentMetadataFields } = await import('../../packages/content/src/config')

    expect(agentMetadataFields).toEqual([
      'title',
      'description',
      'url',
      'route',
      'locale',
      'section',
      'collection',
      'source',
      'updated'
    ])
    expect(defineAgentMetadataFields(['title', 'description', 'url'])).toEqual([
      'title',
      'description',
      'url'
    ])
  })

  test('normalizes explicit collection markdown options', async () => {
    const { resolveAgentMarkdownOptions } = await import('../../packages/content/src/runtime/server/agent-markdown')

    expect(resolveAgentMarkdownOptions({ type: 'data', agent: { markdown: true } })).toBeNull()
    expect(resolveAgentMarkdownOptions({ type: 'page' })).toBeNull()
    expect(resolveAgentMarkdownOptions({ type: 'page', agent: { markdown: true } })).toEqual({
      includeInIndex: true,
      includeInFull: true,
      metadata: []
    })
    expect(resolveAgentMarkdownOptions({
      type: 'page',
      agent: {
        markdown: {
          includeInIndex: false,
          metadata: ['title', 'description', '', 'url']
        }
      }
    })).toEqual({
      includeInIndex: false,
      includeInFull: true,
      metadata: ['title', 'description', 'url']
    })
  })

  test('returns null for disabled collections before querying the provider', async () => {
    const page = vi.fn()
    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        collections: {
          docs: { type: 'page' }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({ page })
    }))

    const { resolveContentMarkdown } = await import('../../packages/content/src/runtime/server/agent-markdown')

    await expect(resolveContentMarkdown({ context: {} } as any, 'docs', '/intro')).resolves.toBeNull()
    expect(page).not.toHaveBeenCalled()
  })

  test('renders normalized markdown with registered serializers', async () => {
    const page = {
      path: '/docs/intro',
      _path: '/intro',
      _collection: 'docs',
      _type: 'markdown',
      _file: 'docs/intro.md',
      title: 'Intro',
      description: 'Start here.',
      body: markdownBody([
        { type: 'element', tag: 'p', children: [{ type: 'text', value: 'Hello ' }, { type: 'element', tag: 'strong', children: [{ type: 'text', value: 'there' }] }] },
        { type: 'element', tag: 'business-contact' }
      ])
    } satisfies Partial<ParsedContent> & { body: ParsedContent['body'] }

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: {
              markdown: {
                metadata: ['title', 'description', 'url']
              }
            }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        page: async () => page
      })
    }))

    const { clearAgentMarkdownSerializers, registerAgentMarkdownSerializer, resolveContentMarkdown } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()
    registerAgentMarkdownSerializer('business-contact', () => '## Contact\n\nEmail: office@example.test')

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/intro')

    expect(resolved).toMatchObject({
      path: '/docs/intro',
      markdownPath: '/docs/intro/index.md',
      rawPath: '/raw/docs/intro.md',
      collection: 'docs',
      title: 'Intro',
      description: 'Start here.',
      sourceFile: 'docs/intro.md',
      metadataFields: ['title', 'description', 'url'],
      includeInIndex: true,
      includeInFull: true
    })
    expect(resolved?.markdown).toContain('# Intro')
    expect(resolved?.markdown).toContain('> Start here.')
    expect(resolved?.markdown).toContain('Hello **there**')
    expect(resolved?.markdown).toContain('## Contact')
    expect(resolved?.markdown).toContain('Email: office@example.test')
  })

  test('renders mapped component tags with bulk registered serializers', async () => {
    const page = {
      path: '/docs/cards',
      _path: '/cards',
      title: 'Cards',
      description: 'Mapped components.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'card',
          props: {
            title: 'Install',
            to: '/docs/install'
          },
          children: [{ type: 'element', tag: 'p', children: [{ type: 'text', value: 'Start here.' }] }]
        }
      ])
    } satisfies Partial<ParsedContent> & { body: ParsedContent['body'] }

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        markdown: {
          tags: {
            card: 'MdcCard'
          }
        },
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        page: async () => page
      })
    }))

    const {
      clearAgentMarkdownSerializers,
      getMarkdownProp,
      linkMarkdown,
      registerAgentMarkdownSerializers,
      resolveContentMarkdown
    } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()
    registerAgentMarkdownSerializers({
      MdcCard: (node, ctx) => [
        `### ${linkMarkdown(getMarkdownProp(node, 'title'), getMarkdownProp(node, 'to'))}`,
        ctx.renderChildren(node)
      ].join('\n\n')
    })

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/cards')

    expect(resolved?.markdown).toContain('### [Install](/docs/install)')
    expect(resolved?.markdown).toContain('Start here.')
  })

  test('preserves unknown components with children as XML fallback', async () => {
    const page = {
      path: '/docs/wrapper',
      _path: '/wrapper',
      title: 'Wrapper',
      description: 'Wrapper components.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'unknown-wrapper',
          props: {
            tone: 'warning',
            class: 'mt-8'
          },
          children: [{ type: 'element', tag: 'p', children: [{ type: 'text', value: 'Visible content.' }] }]
        }
      ])
    } satisfies Partial<ParsedContent> & { body: ParsedContent['body'] }

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        page: async () => page
      })
    }))

    const { clearAgentMarkdownSerializers, resolveContentMarkdown } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/wrapper')

    expect(resolved?.markdown).toContain('<unknown-wrapper tone="warning">')
    expect(resolved?.markdown).toContain('Visible content.')
    expect(resolved?.markdown).toContain('</unknown-wrapper>')
    expect(resolved?.markdown).not.toContain('class=')
    expect(resolved?.markdown).not.toContain('Component omitted: `unknown-wrapper`')
  })

  test('preserves unknown components with props as self-closing XML fallback', async () => {
    const page = {
      path: '/docs/chart',
      _path: '/chart',
      title: 'Chart',
      description: 'Chart component.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'chart',
          props: {
            title: 'Traffic',
            type: 'bar'
          }
        }
      ])
    } satisfies Partial<ParsedContent> & { body: ParsedContent['body'] }

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        page: async () => page
      })
    }))

    const { clearAgentMarkdownSerializers, resolveContentMarkdown } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/chart')

    expect(resolved?.markdown).toContain('<chart title="Traffic" type="bar" />')
    expect(resolved?.markdown).not.toContain('Component omitted: `chart`')
  })

  test('normalizes bound component props for XML fallback', async () => {
    const page = {
      path: '/docs/media',
      _path: '/media',
      title: 'Media',
      description: 'Bound props.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'figure',
          props: {
            src: '/image.png',
            ':bleed': 'true',
            'v-bind:width': 1200,
            class: 'mt-8',
            '@click': 'track'
          }
        }
      ])
    } satisfies Partial<ParsedContent> & { body: ParsedContent['body'] }

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        page: async () => page
      })
    }))

    const { clearAgentMarkdownSerializers, resolveContentMarkdown } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/media')

    expect(resolved?.markdown).toContain('<figure src="/image.png" bleed="true" width="1200" />')
    expect(resolved?.markdown).not.toContain(':bleed')
    expect(resolved?.markdown).not.toContain('v-bind:width')
    expect(resolved?.markdown).not.toContain('class=')
    expect(resolved?.markdown).not.toContain('@click')
  })

  test('renders component-owned XML and JSON payloads through the component API', async () => {
    const page = {
      path: '/docs/chart',
      _path: '/chart',
      title: 'Chart',
      description: 'Chart component.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'chart'
        }
      ])
    } satisfies Partial<ParsedContent> & { body: ParsedContent['body'] }

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        page: async () => page
      })
    }))

    const {
      clearAgentMarkdownSerializers,
      defineAgentMarkdownComponent,
      registerAgentMarkdownComponents,
      resolveContentMarkdown
    } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()
    registerAgentMarkdownComponents({
      chart: defineAgentMarkdownComponent({
        render: (_node, ctx) => ctx.xmlComponent('chart', {}, ctx.jsonFence({
          title: 'Traffic by channel',
          values: [
            { label: 'Search', value: 42 },
            { label: 'Referral', value: 18 }
          ]
        }))
      })
    })

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/chart')

    expect(resolved?.markdown).toContain('<chart>')
    expect(resolved?.markdown).toContain('```json')
    expect(resolved?.markdown).toContain('"title": "Traffic by channel"')
    expect(resolved?.markdown).toContain('"label": "Search"')
    expect(resolved?.markdown).toContain('</chart>')
  })

  test('renders span nodes as transparent inline content', async () => {
    const page = {
      path: '/docs/syntax',
      _path: '/syntax',
      title: 'Syntax',
      description: 'Inline syntax.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'p',
          children: [
            { type: 'text', value: 'Use ' },
            {
              type: 'element',
              tag: 'code',
              children: [
                { type: 'element', tag: 'span', children: [{ type: 'text', value: 'const' }] },
                { type: 'text', value: ' ' },
                { type: 'element', tag: 'span', children: [{ type: 'text', value: 'locale' }] }
              ]
            },
            { type: 'text', value: ' here.' }
          ]
        }
      ])
    } satisfies Partial<ParsedContent> & { body: ParsedContent['body'] }

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        page: async () => page
      })
    }))

    const { clearAgentMarkdownSerializers, resolveContentMarkdown } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/syntax')

    expect(resolved?.markdown).toContain('Use `const locale` here.')
    expect(resolved?.markdown).not.toContain('<span>')
    expect(resolved?.markdown).not.toContain('Component omitted: `span`')
  })

  test('preserves unknown components as explicit fallback notes', async () => {
    const page = {
      path: '/docs/intro',
      _path: '/intro',
      title: 'Intro',
      description: 'Start here.',
      body: markdownBody([
        { type: 'element', tag: 'unknown-block' }
      ])
    } satisfies Partial<ParsedContent> & { body: ParsedContent['body'] }

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        page: async () => page
      })
    }))

    const { clearAgentMarkdownSerializers, resolveContentMarkdown } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/intro')

    expect(resolved?.markdown).toContain('Component omitted: `unknown-block`')
    expect(resolved?.markdown).toContain('no agent markdown serializer yet')
  })
})
