import type { ModuleOptions } from '../types/module'
import { defaultMiniSearchOptions } from './options'

export const contentModuleDefaults = {
  api: {
    baseURL: '/api/_content'
  },
  i18n: true,
  sitemap: true,
  search: {
    engine: 'minisearch',
    ignoredTags: ['script', 'style', 'pre'],
    filterQuery: { _draft: false, _partial: false },
    extraFields: [],
    minisearch: {
      fields: [...defaultMiniSearchOptions.fields],
      storeFields: [...defaultMiniSearchOptions.storeFields],
      boost: { ...defaultMiniSearchOptions.boost },
      fuzzy: defaultMiniSearchOptions.fuzzy,
      prefix: defaultMiniSearchOptions.prefix
    }
  },
  watch: true,
  sources: {},
  ignores: [],
  collections: {},
  markdown: {
    plugins: [],
    tags: {
      code: 'ProseCode',
      img: 'ProseImg',
      pre: 'ProsePre'
    },
    anchorLinks: {
      depth: 4,
      exclude: [1]
    },
    image: 'auto'
  },
  yaml: {},
  csv: {
    delimiter: ',',
    json: true
  },
  navigation: {
    fields: []
  },
  agent: {
    routes: true,
    linkHeaders: true,
    markdownNegotiation: true,
    prerender: true
  },
  contentHead: true,
  respectPathCase: false,
  experimental: {
    stripQueryParameters: false
  }
} satisfies ModuleOptions
