export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      eyebrow: 'Ginko',
      title: 'Playground',
      nav: 'Navigation',
      locale: 'Locale',
      demo: 'Demo pages',
      authors: 'Authors',
      docsQuery: 'Docs Query',
      navPage: 'Nav Debug'
    },
    de: {
      eyebrow: 'Ginko',
      title: 'Spielplatz',
      nav: 'Navigation',
      locale: 'Sprache',
      demo: 'Demo-Seiten',
      authors: 'Autoren',
      docsQuery: 'Docs-Abfrage',
      navPage: 'Navigation'
    }
  }
}))
