import { createContentScenario } from './content-scenario'

export const createBasicScenario = () => createContentScenario({
  name: 'basic',
  defaultLocale: 'en',
  locales: ['en'],
  collections: {
    pages: {
      type: 'page',
      route: '/'
    },
    docs: {
      type: 'page',
      route: '/guide'
    },
    posts: {
      type: 'page',
      route: '/blog'
    },
    data: {
      type: 'data',
      sitemap: false
    }
  },
  documents: [
    {
      collection: 'pages',
      canonicalKey: 'pages:index',
      path: '/',
      title: 'Ginko',
      description: 'Home page',
      order: 0
    },
    {
      collection: 'docs',
      canonicalKey: 'docs:guide',
      path: '/guide',
      title: 'Guide',
      description: 'Guide index',
      order: 1
    },
    {
      collection: 'docs',
      canonicalKey: 'docs:getting-started',
      path: '/guide/getting-started',
      title: 'Getting Started',
      description: 'Start here',
      order: 2
    },
    {
      collection: 'docs',
      canonicalKey: 'docs:hidden',
      path: '/guide/hidden',
      title: 'Hidden Page',
      navigation: false,
      order: 3
    },
    {
      collection: 'posts',
      canonicalKey: 'posts:hello-world',
      path: '/blog/hello-world',
      title: 'Hello World',
      category: 'journal',
      published: true,
      order: 1,
      tags: ['nuxt', 'content']
    },
    {
      collection: 'posts',
      canonicalKey: 'posts:second-post',
      path: '/blog/second-post',
      title: 'Second Post',
      category: 'journal',
      published: true,
      order: 2,
      tags: ['content']
    },
    {
      collection: 'posts',
      canonicalKey: 'posts:third-post',
      path: '/blog/third-post',
      title: 'Third Post',
      draft: true,
      category: 'journal',
      published: false,
      order: 3
    },
    {
      collection: 'data',
      canonicalKey: 'data:app',
      path: '/data/app',
      type: 'json',
      file: { extension: 'json' },
      title: 'App config',
      version: 2,
      owner: 'Matthias'
    },
    {
      collection: 'data',
      canonicalKey: 'data:team',
      path: '/data/team',
      type: 'yaml',
      file: { extension: 'yml' },
      title: 'Team',
      owner: 'Matthias'
    },
    {
      collection: 'data',
      canonicalKey: 'data:metrics',
      path: '/data/metrics',
      type: 'csv',
      file: { extension: 'csv' },
      title: 'Metrics',
      downloads: 42
    }
  ]
})

export const createSaasI18nScenario = () => createContentScenario({
  name: 'saas-i18n',
  defaultLocale: 'en',
  locales: ['en', 'de'],
  localeFallback: { de: ['en'] },
  collections: {
    docs: {
      type: 'page',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/docs', de: '/dokumentation' }
    },
    posts: {
      type: 'page',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: '/blog',
      references: { authors: ['authors'] }
    },
    authors: {
      type: 'page',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/authors', de: '/autoren' }
    },
    versions: {
      type: 'data',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      sitemap: false
    }
  },
  documents: [
    {
      collection: 'docs',
      locale: 'en',
      canonicalKey: 'docs:getting-started',
      path: '/docs/getting-started',
      ref: 'docs.getting-started',
      title: 'Getting Started',
      description: 'Start here',
      order: 1
    },
    {
      collection: 'docs',
      locale: 'de',
      canonicalKey: 'docs:getting-started',
      path: '/dokumentation/erste-schritte',
      ref: 'docs.getting-started',
      title: 'Erste Schritte',
      description: 'Hier starten',
      order: 1
    },
    {
      collection: 'docs',
      locale: 'en',
      canonicalKey: 'docs:markdown-syntax',
      path: '/docs/essentials/markdown-syntax',
      ref: 'docs.markdown-syntax',
      title: 'Markdown Syntax',
      description: 'Writing docs',
      order: 2
    },
    {
      collection: 'docs',
      locale: 'de',
      canonicalKey: 'docs:markdown-syntax',
      path: '/dokumentation/grundlagen/markdown-syntax',
      ref: 'docs.markdown-syntax',
      title: 'Markdown Syntax DE',
      description: 'Dokumentation schreiben',
      order: 2
    },
    {
      collection: 'docs',
      locale: 'en',
      canonicalKey: 'docs:fallback-lab',
      path: '/docs/essentials/fallback-lab',
      ref: 'docs.fallback-lab',
      title: 'Fallback Lab',
      description: 'English-only fallback',
      order: 3
    },
    {
      collection: 'posts',
      locale: 'en',
      canonicalKey: 'posts:cryptocurrencies',
      path: '/blog/cryptocurrencies',
      ref: 'posts.cryptocurrencies',
      title: 'Cryptocurrencies',
      description: 'Market notes',
      date: '2026-01-03',
      authors: ['authors.emily']
    },
    {
      collection: 'posts',
      locale: 'de',
      canonicalKey: 'posts:cryptocurrencies',
      path: '/blog/kryptowaehrungen',
      ref: 'posts.cryptocurrencies',
      title: 'Kryptowaehrungen',
      description: 'Marktnotizen',
      date: '2026-01-03',
      authors: ['authors.emily']
    },
    {
      collection: 'authors',
      locale: 'en',
      canonicalKey: 'authors:emily',
      path: '/authors/emily',
      ref: 'authors.emily',
      title: 'Emily',
      name: 'Emily',
      description: 'Author'
    },
    {
      collection: 'authors',
      locale: 'de',
      canonicalKey: 'authors:emily',
      path: '/autoren/emily',
      ref: 'authors.emily',
      title: 'Emily DE',
      name: 'Emily',
      description: 'Autorin'
    },
    {
      collection: 'versions',
      locale: 'en',
      canonicalKey: 'versions:launch-readiness',
      path: '/changelog/launch-readiness',
      ref: 'versions.launch-readiness',
      title: 'Launch readiness',
      date: '2026-01-01'
    }
  ]
})
