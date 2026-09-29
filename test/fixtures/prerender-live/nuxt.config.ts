// A site whose application pages and one content collection render live data
// at request time. Only the `docs` collection may be prerendered: link
// crawling is off, so `/live` (an app page linked from docs) stays dynamic,
// and the `events` collection opts out with `prerender: false`.
export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },

  modules: [
    '@lupinum/ginko-content'
  ],

  content: {
    i18n: false,
    sitemap: false,
    prerender: {
      crawlLinks: false
    }
  },

  compatibilityDate: '2026-04-14'
})
