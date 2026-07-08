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
      collection: 'docs',
      type: 'markdown',
      file: { path: 'docs/intro.md' },
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

  test('rejects duplicate serializer registration unless explicitly overridden', async () => {
    const {
      clearAgentMarkdownSerializers,
      registerAgentMarkdownSerializer
    } = await import('../../packages/content/src/runtime/server/agent-markdown')

    clearAgentMarkdownSerializers()
    registerAgentMarkdownSerializer('card', () => 'first')
    const same = () => 'same'
    registerAgentMarkdownSerializer('idempotent-card', same)

    expect(() => registerAgentMarkdownSerializer('card', () => 'second')).toThrow(
      /serializer "card" is already registered/
    )
    expect(() => registerAgentMarkdownSerializer('idempotent-card', same)).not.toThrow()
    expect(() => registerAgentMarkdownSerializer('card', () => 'second', { override: true })).not.toThrow()
  })

  test('renders mapped component tags with bulk registered serializers', async () => {
    const page = {
      path: '/docs/cards',
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

  test('drops credential-like props from unknown component XML fallback', async () => {
    const page = {
      path: '/docs/secret',
      title: 'Secret',
      description: 'Secret component.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'embed',
          props: {
            title: 'Public title',
            apiKey: 'leaked-key',
            clientSecret: 'leaked-secret',
            authorization: 'Bearer leaked-token',
            password: 'leaked-password'
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

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/secret')

    expect(resolved?.markdown).toContain('<embed title="Public title" />')
    expect(resolved?.markdown).not.toContain('leaked')
    expect(resolved?.markdown).not.toContain('apiKey')
    expect(resolved?.markdown).not.toContain('clientSecret')
    expect(resolved?.markdown).not.toContain('authorization')
    expect(resolved?.markdown).not.toContain('password')
  })

  test('drops nested credential-like props from XML fallback JSON payloads', async () => {
    const page = {
      path: '/docs/nested-secret',
      title: 'Nested Secret',
      description: 'Nested secret component.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'chart',
          props: {
            title: 'Public chart',
            config: {
              apiKey: 'leaked-key',
              nested: {
                authorization: 'Bearer leaked-token',
                label: 'Visible nested label'
              },
              series: [
                { label: 'Search', value: 42, clientSecret: 'leaked-secret' },
                { label: 'Direct', value: 21 }
              ]
            }
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

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/nested-secret')

    expect(resolved?.markdown).toContain('<chart title="Public chart">')
    expect(resolved?.markdown).toContain('"label": "Visible nested label"')
    expect(resolved?.markdown).toContain('"label": "Search"')
    expect(resolved?.markdown).toContain('"value": 42')
    expect(resolved?.markdown).not.toContain('leaked')
    expect(resolved?.markdown).not.toContain('apiKey')
    expect(resolved?.markdown).not.toContain('authorization')
    expect(resolved?.markdown).not.toContain('clientSecret')
  })

  test('normalizes bound component props for XML fallback', async () => {
    const page = {
      path: '/docs/media',
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

  test('sanitizes unsafe links and images in agent markdown', async () => {
    const page = {
      path: '/docs/media-safety',
      title: 'Media Safety',
      description: 'Unsafe links and images.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'p',
          children: [
            {
              type: 'element',
              tag: 'a',
              props: { href: '//evil.test/path' },
              children: [{ type: 'text', value: 'Protocol relative' }]
            }
          ]
        },
        {
          type: 'element',
          tag: 'img',
          props: {
            src: 'javascript:alert(1)',
            alt: 'Unsafe [image]'
          }
        },
        {
          type: 'element',
          tag: 'img',
          props: {
            src: '/images/a b).png',
            alt: 'Safe [image]'
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

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/media-safety')

    expect(resolved?.markdown).toContain('Protocol relative')
    expect(resolved?.markdown).not.toContain('(//evil.test/path)')
    expect(resolved?.markdown).toContain('Unsafe \\[image\\]')
    expect(resolved?.markdown).not.toContain('javascript:alert')
    expect(resolved?.markdown).toContain('![Safe \\[image\\]](/images/a%20b%29.png)')
  })

  test('rewrites relative page links against the current content route', async () => {
    const page = {
      path: '/docs/reference/api-keys',
      title: 'API Keys',
      description: 'Relative links.',
      body: markdownBody([
        {
          type: 'element',
          tag: 'p',
          children: [
            {
              type: 'element',
              tag: 'a',
              props: { href: './rotation#steps' },
              children: [{ type: 'text', value: 'Rotation' }]
            },
            { type: 'text', value: ' and ' },
            {
              type: 'element',
              tag: 'a',
              props: { href: '../intro' },
              children: [{ type: 'text', value: 'Intro' }]
            }
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

    const resolved = await resolveContentMarkdown({ context: {} } as any, 'docs', '/docs/reference/api-keys')

    expect(resolved?.markdown).toContain('[Rotation](/raw/docs/reference/rotation.md#steps)')
    expect(resolved?.markdown).toContain('[Intro](/raw/docs/intro.md)')
  })

  test('preserves unknown components as explicit fallback notes', async () => {
    const page = {
      path: '/docs/intro',
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

  test('does not render markdown bodies while building the agent page index', async () => {
    const query = vi.fn(async () => ({
      result: [
        {
          path: '/docs/intro',
          title: 'Intro',
          description: 'Start here.',
          body: markdownBody([
            { type: 'element', tag: 'expensive-component' }
          ])
        }
      ],
      skip: 0,
      limit: 0,
      total: 1
    }))

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        defaultLocale: 'en',
        locales: ['en'],
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site.',
            url: 'https://example.test',
            defaultLocale: 'en',
            locales: ['en']
          },
          sections: [{ id: 'docs', title: 'Docs', order: 10 }]
        },
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { section: 'docs', markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({ query })
    }))

    const { clearAgentMarkdownSerializers, registerAgentMarkdownSerializer } = await import('../../packages/content/src/runtime/server/agent-markdown')
    const { buildAgentPageIndex } = await import('../../packages/content/src/runtime/server/agent-site')
    const serializer = vi.fn(() => 'rendered')

    clearAgentMarkdownSerializers()
    registerAgentMarkdownSerializer('expensive-component', serializer)

    const pages = await buildAgentPageIndex({ node: { req: { headers: {} } } } as any)

    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({
      path: '/docs/intro',
      rawPath: '/raw/docs/intro.md',
      markdownPath: '/docs/intro/index.md'
    })
    expect(serializer).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      plan: expect.objectContaining({
        projection: expect.objectContaining({ only: expect.not.arrayContaining(['body']) })
      })
    }))
  })

  test('collects only raw markdown and llms prerender routes', async () => {
    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        defaultLocale: 'en',
        locales: ['en'],
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site.',
            url: 'https://example.test',
            defaultLocale: 'en',
            locales: ['en']
          },
          sections: [{ id: 'docs', title: 'Docs', order: 10 }]
        },
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { section: 'docs', markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        query: async () => ({
          result: [
            {
              path: '/docs/intro',
              file: { path: 'content/docs/intro.md' },
              title: 'Intro'
            }
          ],
          skip: 0,
          limit: 0,
          total: 1
        })
      })
    }))

    const { collectAgentMarkdownPrerenderRoutes } = await import('../../packages/content/src/runtime/server/agent-site')

    await expect(collectAgentMarkdownPrerenderRoutes({ node: { req: { headers: {} } } } as any)).resolves.toEqual([
      '/raw/docs/intro.md',
      '/llms.txt',
      '/llms-full.txt'
    ])
  })

  test('uses the source-locale public route for localized fallback agent pages', async () => {
    const query = vi.fn(async (_event, params) => {
      // Providers now receive the lowered wire query (CS-5), not builder params.
      expect(params).toEqual(expect.objectContaining({
        v: 1,
        plan: expect.objectContaining({
          resolveLocale: expect.objectContaining({ locale: 'de' }),
          projection: expect.objectContaining({ only: expect.arrayContaining(['path', 'locale', 'localePaths']) })
        })
      }))

      return {
        result: [
          {
            path: '/guide/advanced',
            locale: 'en',
            resolved: {
              locale: 'en',
              fallback: true
            },
            file: { path: 'en/1.guide/2.advanced.md' },
            title: 'Advanced'
          }
        ],
        skip: 0,
        limit: 0,
        total: 1
      }
    })

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        defaultLocale: 'en',
        locales: ['en', 'de'],
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site.',
            url: 'https://example.test',
            defaultLocale: 'en',
            locales: ['en', 'de']
          },
          sections: [{ id: 'docs', title: { en: 'Docs', de: 'Dokumentation' }, order: 10 }]
        },
        collections: {
          docs: {
            type: 'page',
            route: {
              en: '/guide',
              de: '/leitfaden'
            },
            i18n: {
              defaultLocale: 'en',
              locales: ['en', 'de']
            },
            agent: { section: 'docs', markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({ query })
    }))

    const { buildAgentPageIndex } = await import('../../packages/content/src/runtime/server/agent-site')

    await expect(buildAgentPageIndex({ node: { req: { headers: {} } } } as any, 'de')).resolves.toEqual([
      expect.objectContaining({
        path: '/de/guide/advanced',
        rawPath: '/raw/de/guide/advanced.md',
        markdownPath: '/de/guide/advanced/index.md',
        locale: 'de'
      })
    ])
  })

  test('fails clearly when app-owned and content-owned agent pages share a route', async () => {
    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        defaultLocale: 'en',
        locales: ['en'],
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site.',
            url: 'https://example.test',
            defaultLocale: 'en',
            locales: ['en']
          },
          pages: [
            {
              id: 'intro',
              route: '/docs/intro',
              section: 'docs',
              title: 'App Intro',
              description: 'App intro.',
              render: () => '# App Intro'
            }
          ],
          sections: [{ id: 'docs', title: 'Docs', order: 10 }]
        },
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { section: 'docs', markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        query: async () => ({
          result: [
            {
              path: '/docs/intro',
              title: 'Content Intro',
              description: 'Content intro.'
            }
          ],
          skip: 0,
          limit: 0,
          total: 1
        })
      })
    }))

    const { buildAgentPageIndex } = await import('../../packages/content/src/runtime/server/agent-site')

    await expect(buildAgentPageIndex({ node: { req: { headers: {} } } } as any)).rejects.toThrow(
      /Duplicate agent route "\/docs\/intro"/
    )
  })

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
    const { agentRawPathForRoute, agentMarkdownPathForRoute } = await import('../../packages/content/src/runtime/agent-paths')

    expect(agentRawPathForRoute('/')).toBe('/raw/index.md')
    expect(agentRawPathForRoute('/docs/intro/')).toBe('/raw/docs/intro.md')
    expect(agentMarkdownPathForRoute('/docs/intro/')).toBe('/docs/intro/index.md')
  })

  test('detects unsafe agent route paths before markdown resolution', async () => {
    const { isUnsafeAgentRoutePath, normalizeAgentRoutePath } = await import('../../packages/content/src/runtime/agent-paths')

    expect(isUnsafeAgentRoutePath('/docs/intro')).toBe(false)
    expect(isUnsafeAgentRoutePath('/docs//intro')).toBe(false)
    expect(normalizeAgentRoutePath('/docs//intro')).toBe('/docs/intro')
    expect(isUnsafeAgentRoutePath('/../secret')).toBe(true)
    expect(isUnsafeAgentRoutePath('/docs/%2e%2e/secret')).toBe(true)
    expect(isUnsafeAgentRoutePath('/docs/%252e%252e/secret')).toBe(true)
    expect(isUnsafeAgentRoutePath('/docs/%00secret')).toBe(true)
  })
})
