import { fileURLToPath } from 'url'
import { resolve } from 'pathe'

const themeDir = fileURLToPath(new URL('./', import.meta.url))
const resolveThemeDir = (path: string) => resolve(themeDir, path)

export default defineNuxtConfig({
  devtools: { enabled: false },
  components: [
    {
      global: true,
      path: resolveThemeDir('./components')
    },
    {
      global: true,
      path: resolveThemeDir('./components/content')
    }
  ],
  modules: [
    '@lupinum/ginko-content'
  ],
  content: {
    componentPolicy: {
      components: {
        'layer-priority': { kind: 'block', props: {}, slots: [], media: null }
      }
    },
    navigation: {
      fields: ['icon']
    },
    markdown: {
      plugins: [
        'shiki',
        ['toc', { depth: 2, searchDepth: 2 }],
        'summary'
      ]
    }
  }
})
