export default {
  ginkoDocs: {
    site: {
      url: 'https://ginko-content.nuxt.dev',
      name: { en: 'Ginko Content' },
      description: { en: 'Filesystem-first content for Nuxt 4.' },
      logo: { light: '/icon.png', dark: '/icon.png' },
      localeSwitcher: 'dropdown',
      docsSidebarSwitcher: 'tabs'
    },
    social: {
      github: 'https://github.com/lupinum-dev/ginko-content'
    },
    repository: {
      url: 'https://github.com/lupinum-dev/ginko-content',
      branch: 'main',
      contentDirectory: 'docs/content'
    },
    landing: {
      eyebrow: { en: 'Content infrastructure for Nuxt 4' },
      title: { en: 'Define content once. Use it everywhere.' },
      description: {
        en: 'Typed collections power pages, server reads, navigation, localization, search, sitemaps, and agent-readable Markdown from one canonical model.'
      },
      primary: {
        label: { en: 'Get started' },
        to: { en: '/docs/get-started/installation' }
      },
      secondary: {
        label: { en: 'View on GitHub' },
        to: { en: 'https://github.com/lupinum-dev/ginko-content' }
      },
      features: [
        {
          title: { en: 'One content model' },
          description: { en: 'Collections remain the source of truth for identity, shape, routes, and derived output.' },
          icon: 'lucide:boxes'
        },
        {
          title: { en: 'Localized by design' },
          description: { en: 'Translated slugs, fallbacks, alternates, search, and sitemaps follow one locale policy.' },
          icon: 'lucide:languages'
        },
        {
          title: { en: 'Agent ready' },
          description: { en: 'Raw Markdown, LLM indexes, serializers, and MCP tools use the same resolved documents.' },
          icon: 'lucide:bot'
        }
      ]
    }
  }
}
