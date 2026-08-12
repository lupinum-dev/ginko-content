export default defineNuxtConfig({
  modules: [
    '@lupinum/ginko-content'
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
        'app-slot': { kind: 'block', props: {}, slots: ['default', 'named-slot'], media: null },
        'app-parent': { kind: 'block', props: {}, slots: ['default'], media: null },
        'app-nested': { kind: 'block', props: {}, slots: ['default'], media: null }
      }
    },
    markdown: {
      plugins: [
        'shiki',
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
