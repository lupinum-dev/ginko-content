import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, test, vi } from 'vitest'

const runtimeConfig = vi.hoisted(() => ({
  public: {
    content: {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      links: {} as Record<string, Record<string, { route: string }>>,
      markdown: {} as { image?: string }
    }
  }
}))

vi.mock('#imports', () => ({
  useRuntimeConfig: () => runtimeConfig
}))

vi.mock('../../packages/content/src/runtime/app/composables/content-i18n', () => ({
  useLocalePath: () => (value: string | { name?: string, hash?: string, params?: Record<string, unknown>, query?: Record<string, unknown> }, locale?: string) => {
    const route = typeof value === 'string' ? value : value.name || ''
    const path = route.startsWith('/') ? route : `/${route}`
    const localized = locale && locale !== 'en' ? `/${locale}${path}` : path
    const query = typeof value === 'object' && value.query
      ? `?${new URLSearchParams(Object.entries(value.query).filter(([, item]) => item !== undefined).map(([key, item]) => [key, String(item)] as const)).toString()}`
      : ''
    return `${localized}${query}${typeof value === 'object' && value.hash ? value.hash : ''}`
  },
  useRouteBaseName: () => () => undefined,
  useSetI18nParams: () => () => {},
  useSwitchLocalePath: () => () => ''
}))

describe('render component contracts', () => {
  test('ContentRenderer does not serialize unsupported values into HTML', async () => {
    const ContentRenderer = (await import('../../packages/content/src/runtime/app/components/ContentRenderer.vue')).default
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const html = await renderToString(createSSRApp({
      render: () => h(ContentRenderer, {
        value: {
          path: '/docs/missing-body',
          title: 'Missing Body'
        }
      })
    }))

    expect(html).not.toContain('You should use slots with &lt;ContentRenderer&gt;')
    expect(html).not.toContain('Missing Body')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not render body for "/docs/missing-body"'))

    warn.mockRestore()
  })

  test('ContentRenderer uses the empty slot for empty or unsupported content', async () => {
    const ContentRenderer = (await import('../../packages/content/src/runtime/app/components/ContentRenderer.vue')).default
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const html = await renderToString(createSSRApp({
      render: () => h(ContentRenderer, {
        value: {
          title: 'Missing Body'
        }
      }, {
        empty: () => h('p', 'No content available')
      })
    }))

    expect(html).toContain('No content available')
    expect(html).not.toContain('Missing Body')
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  test('markdown renderer localizes link props at render time', async () => {
    const { localizeMarkdownNodeProps } = await import('../../packages/content/src/runtime/app/components/internal/MarkdownRenderer')

    expect(localizeMarkdownNodeProps({
      href: '/demarrage#manual',
      ':links': '[{"to":"/demarrage/install"},{"href":"/demarrage/usage"}]'
    }, 'fr', 'en', ['en', 'fr'])).toEqual({
      href: '/fr/demarrage#manual',
      ':links': '[{"to":"/fr/demarrage/install"},{"href":"/fr/demarrage/usage"}]'
    })

    expect(localizeMarkdownNodeProps({
      href: '/de/preise'
    }, 'de', 'en', ['en', 'de'])).toEqual({
      href: '/de/preise'
    })
  })

  test('markdown render refs use requested locale for quick links when content falls back', async () => {
    const { resolveMarkdownRenderRefs } = await import('../../packages/content/src/core/references/resolve')
    const localePath = (value: { name: string, hash?: string }, locale?: string) =>
      `${locale && locale !== 'en' ? `/${locale}` : ''}/${value.name}${value.hash || ''}`

    const body = {
      type: 'root',
      children: [
        { type: 'element', tag: 'card', props: { to: '$main.pricing#plans' }, children: [] }
      ]
    }

    expect(resolveMarkdownRenderRefs(
      body,
      { '$main.pricing#plans': '$main.pricing#plans' },
      { main: { pricing: { route: 'pricing' } } },
      route => localePath(route, 'de')
    )).toEqual({
      '$main.pricing#plans': '/de/pricing#plans'
    })
  })

  test('resolveDocumentContentComponents shares discovery and local/global resolution rules', async () => {
    const { loadContentComponentEntries, resolveDocumentContentComponents } = await import('../../packages/content/src/integrations/vue/content-components')
    const LocalCard = { name: 'LocalCard' }
    const GlobalHero = { name: 'GlobalHero' }
    const localLoader = vi.fn(async () => LocalCard)

    const body = {
      type: 'root',
      children: [
        { type: 'element', tag: 'ProseP', props: {}, children: [] },
        { type: 'element', tag: 'img', props: { src: '/hero.png' }, children: [] },
        { type: 'element', tag: 'hero-banner', props: {}, children: [] },
        { type: 'element', tag: 'feature-card', props: {}, children: [] }
      ]
    }

    expect(loadContentComponentEntries(body as any, { 'hero-banner': 'HeroBanner', img: 'ProseImg' })).toEqual([
      ['ProseP', 'ProseP'],
      ['img', 'ProseImg'],
      ['hero-banner', 'HeroBanner'],
      ['feature-card', 'feature-card']
    ])

    const resolved = await resolveDocumentContentComponents(body as any, {
      tags: { 'hero-banner': 'HeroBanner', img: 'ProseImg' },
      catalog: {
        globalComponents: ['HeroBanner'],
        localComponents: ['FeatureCard'],
        localComponentLoaders: { FeatureCard: localLoader },
        componentRegistry: { HeroBanner: GlobalHero }
      }
    })

    expect(resolved).toEqual({
      ProseP: 'ProseP',
      img: 'ProseImg',
      'hero-banner': GlobalHero,
      'feature-card': LocalCard
    })
    expect(localLoader).toHaveBeenCalledTimes(1)
  })

  test('ships a ProseImg component with native and Nuxt Image rendering paths', async () => {
    const ProseImg = (await import('../../packages/content/src/runtime/app/components/Prose/ProseImg.vue')).default
    const { resolveMarkdownRendererComponents, resolveMarkdownRendererFallbackComponents } = await import('../../packages/content/src/runtime/markdown/plugins')

    runtimeConfig.public.content.markdown.image = 'img'
    const native = await renderToString(createSSRApp({
      render: () => h(ProseImg, { src: '/hero.png', alt: 'Hero', loading: 'eager' })
    }))

    expect(native).toContain('<img')
    expect(native).toContain('src="/hero.png"')
    expect(native).toContain('alt="Hero"')
    expect(native).toContain('loading="eager"')

    runtimeConfig.public.content.markdown.image = 'nuxt-image'
    const app = createSSRApp({
      render: () => h(ProseImg, { src: '/hero.png', alt: 'Hero', loading: 'lazy' })
    })
    app.component('NuxtImg', {
      props: ['src', 'alt', 'loading'],
      render() {
        return h('picture', {
          'data-nuxt-img': 'true',
          'data-src': this.$props.src,
          'data-alt': this.$props.alt,
          'data-loading': this.$props.loading
        })
      }
    })
    const nuxtImage = await renderToString(app)

    expect(nuxtImage).toContain('data-nuxt-img="true"')
    expect(nuxtImage).toContain('data-src="/hero.png"')
    expect(nuxtImage).toContain('data-loading="lazy"')
    expect(resolveMarkdownRendererComponents([])).not.toHaveProperty('ProseImg')
    expect(resolveMarkdownRendererFallbackComponents()).toHaveProperty('ProseImg')
  })

  test('app-registered prose components win over builtin fallbacks', async () => {
    const MarkdownRenderer = (await import('../../packages/content/src/runtime/app/components/internal/MarkdownRenderer')).default
    const { resolveMarkdownRendererFallbackComponents } = await import('../../packages/content/src/runtime/markdown/plugins')
    runtimeConfig.public.content.markdown.image = 'img'

    const tree = {
      type: 'root',
      children: [
        { type: 'element', tag: 'img', props: { src: '/hero.png', alt: 'Hero' }, children: [] }
      ]
    }
    const renderImage = (register: boolean) => {
      const app = createSSRApp({
        render: () => h(MarkdownRenderer, {
          tree: tree as any,
          components: { img: 'ProseImg' },
          fallbackComponents: resolveMarkdownRendererFallbackComponents()
        })
      })
      if (register) {
        app.component('ProseImg', {
          props: ['src', 'alt'],
          render() {
            return h('img', { 'data-app-prose-img': 'true', src: this.$props.src, alt: this.$props.alt })
          }
        })
      }
      return renderToString(app)
    }

    expect(await renderImage(true)).toContain('data-app-prose-img="true"')

    const builtin = await renderImage(false)
    expect(builtin).not.toContain('data-app-prose-img')
    expect(builtin).toContain('src="/hero.png"')
  })

  test('a consumer tags remap resolves through the registry instead of the builtin', async () => {
    const MarkdownRenderer = (await import('../../packages/content/src/runtime/app/components/internal/MarkdownRenderer')).default
    const { resolveMarkdownRendererFallbackComponents } = await import('../../packages/content/src/runtime/markdown/plugins')

    const app = createSSRApp({
      render: () => h(MarkdownRenderer, {
        tree: {
          type: 'root',
          children: [
            { type: 'element', tag: 'img', props: { src: '/hero.png', alt: 'Hero' }, children: [] }
          ]
        } as any,
        components: { img: 'MyImage' },
        fallbackComponents: resolveMarkdownRendererFallbackComponents()
      })
    })
    app.component('MyImage', {
      props: ['src', 'alt'],
      render() {
        return h('img', { 'data-my-image': 'true', src: this.$props.src })
      }
    })

    expect(await renderToString(app)).toContain('data-my-image="true"')
  })
})
