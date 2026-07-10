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
    // `partial` is structural (never a real searchable page) and always
    // excluded by default. `draft` is NOT baked in here: draft visibility in
    // search follows the one core environment/preview decision applied at
    // the query layer (VNEXT.md 13.6/24.2), not a hardcoded caller filter.
    filterQuery: { partial: false },
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
  links: {},
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
  respectPathCase: false,
  experimental: {
    stripQueryParameters: false
  }
} satisfies ModuleOptions
