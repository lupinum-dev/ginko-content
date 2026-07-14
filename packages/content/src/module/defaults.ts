import type { ModuleOptions } from '../types/module'

export const contentModuleDefaults = {
  api: {
    baseURL: '/api/_content'
  },
  i18n: true,
  sitemap: true,
  search: false,
  validation: 'report',
  watch: true,
  sources: {},
  ignores: [],
  links: {},
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
  respectPathCase: false
} satisfies ModuleOptions
