export default defineNuxtConfig({
  modules: [
    '@lupinum/ginko-content',
    '@nuxt/ui'
  ],
  content: {
    componentPolicy: {
      components: {
        'github-button': { kind: 'inline', props: {}, slots: [], media: null },
        'app-props': {
          kind: 'inline',
          props: { icon: { type: 'string', required: false } },
          slots: [],
          media: null
        },
        'app-slot': { kind: 'block', props: {}, slots: ['default', 'namedSlot'], media: null },
        'app-parent': { kind: 'block', props: {}, slots: ['default'], media: null },
        'app-nested': { kind: 'block', props: {}, slots: ['default'], media: null },
        template: {
          kind: 'block',
          props: { name: { type: 'string', required: true } },
          slots: ['default'],
          media: null
        }
      }
    },
    markdown: {
      plugins: [
        ['highlight', { theme: 'one-dark-pro' }],
        ['toc', { depth: 2, searchDepth: 2 }],
        'summary'
      ]
    }
  },
  components: [{
    path: '~/components',
    global: true
  }]
})
