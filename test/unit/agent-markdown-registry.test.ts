import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { MarkdownNode, MarkdownRoot } from '../../packages/content/src/types/content'
import {
  createAgentMarkdownRegistry,
  type AgentMarkdownRenderContext
} from '../../packages/content/src/features/agent/agent-markdown'
import { renderAgentMarkdownBody } from '../../packages/content/src/features/agent/walker'

const body = (children: MarkdownNode[]): MarkdownRoot => ({ type: 'root', children })

const renderContext = (
  overrides: Partial<AgentMarkdownRenderContext> = {}
): AgentMarkdownRenderContext => ({
  collection: 'docs',
  page: { path: '/docs/intro' } as never,
  path: '/docs/intro',
  locale: undefined,
  registry: createAgentMarkdownRegistry(),
  tagAliases: {},
  defaultLocale: 'en',
  locales: ['en'],
  ...overrides
})

describe('agent markdown per-app registry', () => {
  test('registries are isolated per app', () => {
    const a = createAgentMarkdownRegistry()
    const b = createAgentMarkdownRegistry()
    const serializer = () => 'A'

    a.register('card', serializer)

    expect(a.get('card')).toBe(serializer)
    // A second registry never observes the first registry's registrations.
    expect(b.get('card')).toBeUndefined()
  })

  test('registration API shape: register / registerMany / component(s) / clear / get', () => {
    const registry = createAgentMarkdownRegistry()
    const first = () => 'first'

    registry.register('card', first)
    expect(registry.get('card')).toBe(first)

    // Re-registering the identical serializer is a no-op, not an error.
    expect(() => registry.register('card', first)).not.toThrow()

    // A different serializer under an occupied name throws unless overridden.
    expect(() => registry.register('card', () => 'second')).toThrow(
      /serializer "card" is already registered/
    )

    const override = () => 'override'
    registry.register('card', override, { override: true })
    expect(registry.get('card')).toBe(override)

    registry.registerMany({ alpha: () => 'a', beta: () => 'b' })
    expect(registry.get('alpha')).toBeTypeOf('function')
    expect(registry.get('beta')).toBeTypeOf('function')

    const component = { render: () => 'c' }
    registry.registerComponent('gamma', component)
    expect(registry.get('gamma')).toBe(component.render)

    registry.registerComponents({ delta: { render: () => 'd' } })
    expect(registry.get('delta')).toBeTypeOf('function')

    registry.clear()
    expect(registry.get('card')).toBeUndefined()
    expect(registry.get('alpha')).toBeUndefined()
    expect(registry.get('gamma')).toBeUndefined()
  })

  test('walker is a pure function of (body, context) with no global registry reads', () => {
    const registry = createAgentMarkdownRegistry()
    registry.register('callout', (node, ctx) => `CALLOUT:${ctx.renderChildren(node)}`)

    const doc = body([
      { type: 'element', tag: 'p', children: [{ type: 'text', value: 'Hello' }] },
      { type: 'element', tag: 'callout', children: [{ type: 'text', value: 'note' }] }
    ])

    const ctx = renderContext({ registry })
    const first = renderAgentMarkdownBody(doc, ctx)
    const second = renderAgentMarkdownBody(doc, ctx)

    // Same node + same context => identical markdown.
    expect(first).toBe(second)
    expect(first).toContain('Hello')
    expect(first).toContain('CALLOUT:note')

    // A different registry with a same-named serializer producing different
    // output proves the walker reads ctx.registry, not any module-global state.
    const other = createAgentMarkdownRegistry()
    other.register('callout', () => 'OTHER')
    const otherOut = renderAgentMarkdownBody(doc, renderContext({ registry: other }))

    expect(otherOut).toContain('OTHER')
    expect(otherOut).not.toContain('CALLOUT:note')
  })

  test('walker resolves component tags through ctx.tagAliases', () => {
    const registry = createAgentMarkdownRegistry()
    registry.register('MdcCard', () => 'ALIASED')

    const doc = body([{ type: 'element', tag: 'card' }])
    const out = renderAgentMarkdownBody(doc, renderContext({ registry, tagAliases: { card: 'MdcCard' } }))

    expect(out).toContain('ALIASED')
  })

  test("walker rewrites stable content refs through the document's resolved refs", () => {
    const doc = body([
      {
        type: 'element',
        tag: 'a',
        props: { href: '$docs/essentials/navigation' },
        children: [{ type: 'text', value: 'Navigation' }]
      }
    ])
    const out = renderAgentMarkdownBody(
      doc,
      renderContext({
        page: {
          path: '/docs/essentials/markdown-syntax',
          resolvedRefs: { '$docs/essentials/navigation': '/docs/essentials/navigation' }
        } as never
      })
    )

    expect(out).toContain('[Navigation](/raw/docs/essentials/navigation.md)')
    expect(out).not.toContain('$docs')
  })

  test('walker resolves stable refs inside serialized component props', () => {
    const registry = createAgentMarkdownRegistry()
    registry.register('card', (node, ctx) => ctx.xmlComponent('card', ctx.cleanProps(node)))
    const doc = body([
      { type: 'element', tag: 'card', props: { to: '$docs/navigation', title: 'Navigation' } }
    ])
    const out = renderAgentMarkdownBody(
      doc,
      renderContext({
        registry,
        page: {
          path: '/docs/components',
          resolvedRefs: { '$docs/navigation': '/docs/navigation' }
        } as never
      })
    )

    expect(out).toContain('to="/docs/navigation"')
    expect(out).not.toContain('$docs')
  })
})

describe('agent markdown module setup (dev HMR)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({ collections: {} })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({})
    }))
  })

  test('re-running module evaluation yields a fresh registry instead of accumulating', async () => {
    const {
      getAgentMarkdownRegistry,
      registerAgentMarkdownSerializer
    } = await import('../../packages/content/src/runtime/server/agent-markdown')

    const v1 = () => 'v1'
    registerAgentMarkdownSerializer('card', v1)
    expect(getAgentMarkdownRegistry().get('card')).toBe(v1)

    vi.resetModules()
    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({ collections: {} })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({})
    }))

    const freshModule = await import('../../packages/content/src/runtime/server/agent-markdown')
    expect(freshModule.getAgentMarkdownRegistry().get('card')).toBeUndefined()

    // The user plugin re-runs and re-registers the same tag. Against the old
    // module-global map this threw "already registered"; against a per-app
    // registry it targets the fresh instance and succeeds.
    const v2 = () => 'v2'
    expect(() => freshModule.registerAgentMarkdownSerializer('card', v2)).not.toThrow()
    expect(freshModule.getAgentMarkdownRegistry().get('card')).toBe(v2)
  })
})
