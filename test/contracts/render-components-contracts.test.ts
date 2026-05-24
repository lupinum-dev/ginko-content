import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, test, vi } from 'vitest'

const runtimeConfig = vi.hoisted(() => ({
  public: {
    content: {
      markdown: {} as { image?: string }
    }
  }
}))

vi.mock('#imports', () => ({
  useRuntimeConfig: () => runtimeConfig
}))

describe('render component contracts', () => {
  test('markdown renderer localizes link props at render time', async () => {
    const { localizeMarkdownNodeProps } = await import('../../packages/content/src/runtime/app/components/internal/MarkdownRenderer')

    expect(localizeMarkdownNodeProps({
      href: '/demarrage#manual',
      ':links': '[{"to":"/demarrage/install"},{"href":"/demarrage/usage"}]'
    }, 'fr', 'en', ['en', 'fr'])).toEqual({
      href: '/fr/demarrage#manual',
      ':links': '[{"to":"/fr/demarrage/install"},{"href":"/fr/demarrage/usage"}]'
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
    const { resolveMarkdownRendererComponents } = await import('../../packages/content/src/runtime/markdown/plugins')

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
    expect(resolveMarkdownRendererComponents([])).toHaveProperty('ProseImg')
  })
})
