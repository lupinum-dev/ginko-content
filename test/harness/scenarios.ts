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
      _collection: 'pages',
      _canonicalKey: 'pages:index',
      _path: '/',
      title: 'Ginko',
      description: 'Home page',
      order: 0
    },
    {
      _collection: 'docs',
      _canonicalKey: 'docs:guide',
      _path: '/guide',
      title: 'Guide',
      description: 'Guide index',
      order: 1
    },
    {
      _collection: 'docs',
      _canonicalKey: 'docs:getting-started',
      _path: '/guide/getting-started',
      title: 'Getting Started',
      description: 'Start here',
      order: 2
    },
    {
      _collection: 'docs',
      _canonicalKey: 'docs:hidden',
      _path: '/guide/hidden',
      title: 'Hidden Page',
      navigation: false,
      order: 3
    },
    {
      _collection: 'posts',
      _canonicalKey: 'posts:hello-world',
      _path: '/blog/hello-world',
      title: 'Hello World',
      category: 'journal',
      published: true,
      order: 1,
      tags: ['nuxt', 'content']
    },
    {
      _collection: 'posts',
      _canonicalKey: 'posts:second-post',
      _path: '/blog/second-post',
      title: 'Second Post',
      category: 'journal',
      published: true,
      order: 2,
      tags: ['content']
    },
    {
      _collection: 'posts',
      _canonicalKey: 'posts:third-post',
      _path: '/blog/third-post',
      title: 'Third Post',
      _draft: true,
      category: 'journal',
      published: false,
      order: 3
    },
    {
      _collection: 'data',
      _canonicalKey: 'data:app',
      _path: '/data/app',
      _type: 'json',
      _extension: 'json',
      title: 'App config',
      version: 2,
      owner: 'Matthias'
    },
    {
      _collection: 'data',
      _canonicalKey: 'data:team',
      _path: '/data/team',
      _type: 'yaml',
      _extension: 'yml',
      title: 'Team',
      owner: 'Matthias'
    },
    {
      _collection: 'data',
      _canonicalKey: 'data:metrics',
      _path: '/data/metrics',
      _type: 'csv',
      _extension: 'csv',
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
      route: '/blog'
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
      _collection: 'docs',
      _locale: 'en',
      _canonicalKey: 'docs:getting-started',
      _path: '/docs/getting-started',
      ref: 'docs.getting-started',
      title: 'Getting Started',
      description: 'Start here',
      order: 1
    },
    {
      _collection: 'docs',
      _locale: 'de',
      _canonicalKey: 'docs:getting-started',
      _path: '/dokumentation/erste-schritte',
      ref: 'docs.getting-started',
      title: 'Erste Schritte',
      description: 'Hier starten',
      order: 1
    },
    {
      _collection: 'docs',
      _locale: 'en',
      _canonicalKey: 'docs:markdown-syntax',
      _path: '/docs/essentials/markdown-syntax',
      ref: 'docs.markdown-syntax',
      title: 'Markdown Syntax',
      description: 'Writing docs',
      order: 2
    },
    {
      _collection: 'docs',
      _locale: 'de',
      _canonicalKey: 'docs:markdown-syntax',
      _path: '/dokumentation/grundlagen/markdown-syntax',
      ref: 'docs.markdown-syntax',
      title: 'Markdown Syntax DE',
      description: 'Dokumentation schreiben',
      order: 2
    },
    {
      _collection: 'docs',
      _locale: 'en',
      _canonicalKey: 'docs:fallback-lab',
      _path: '/docs/essentials/fallback-lab',
      ref: 'docs.fallback-lab',
      title: 'Fallback Lab',
      description: 'English-only fallback',
      order: 3
    },
    {
      _collection: 'posts',
      _locale: 'en',
      _canonicalKey: 'posts:cryptocurrencies',
      _path: '/blog/cryptocurrencies',
      ref: 'posts.cryptocurrencies',
      title: 'Cryptocurrencies',
      description: 'Market notes',
      date: '2026-01-03',
      authors: ['authors.emily']
    },
    {
      _collection: 'posts',
      _locale: 'de',
      _canonicalKey: 'posts:cryptocurrencies',
      _path: '/blog/kryptowaehrungen',
      ref: 'posts.cryptocurrencies',
      title: 'Kryptowaehrungen',
      description: 'Marktnotizen',
      date: '2026-01-03',
      authors: ['authors.emily']
    },
    {
      _collection: 'authors',
      _locale: 'en',
      _canonicalKey: 'authors:emily',
      _path: '/authors/emily',
      ref: 'authors.emily',
      title: 'Emily',
      name: 'Emily',
      description: 'Author'
    },
    {
      _collection: 'authors',
      _locale: 'de',
      _canonicalKey: 'authors:emily',
      _path: '/autoren/emily',
      ref: 'authors.emily',
      title: 'Emily DE',
      name: 'Emily',
      description: 'Autorin'
    },
    {
      _collection: 'versions',
      _locale: 'en',
      _canonicalKey: 'versions:launch-readiness',
      _path: '/changelog/launch-readiness',
      ref: 'versions.launch-readiness',
      title: 'Launch readiness',
      date: '2026-01-01'
    }
  ]
})
