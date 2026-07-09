import { describe, expect, test } from 'vitest'
import { formatRouteManifest, normalizeRouteManifest } from '../helpers/route-manifest'

describe('route manifest normalization (T2-1, R-3)', () => {
  test('keeps HTML pages including root-level special pages', () => {
    const files = [
      'index.html',
      '200.html',
      '404.html',
      '404/index.html',
      'guide/getting-started/index.html'
    ]

    expect(normalizeRouteManifest(files)).toEqual([
      '200.html',
      '404.html',
      '404/index.html',
      'guide/getting-started/index.html',
      'index.html'
    ])
  })

  test('drops per-route _payload.json content-hash churn', () => {
    const files = [
      'guide/getting-started/index.html',
      'guide/getting-started/_payload.json',
      '_payload.json'
    ]

    expect(normalizeRouteManifest(files)).toEqual(['guide/getting-started/index.html'])
  })

  test('drops hash-named bundler assets under _nuxt/', () => {
    const files = [
      'index.html',
      '_nuxt/B7Y5MyAD.js',
      '_nuxt/entry.CxPvNC4W.css'
    ]

    expect(normalizeRouteManifest(files)).toEqual(['index.html'])
  })

  test('drops hash-named _i18n message bundles and api/_content query+navigation cache entries', () => {
    const files = [
      'index.html',
      '_i18n/e3b0c442/de/messages.json',
      'api/_content/query/-SqoAmFMZR3t4-C_SlrpTIssHiBOyIFHur06FI3TBMs.1783624261032/eyJjb2xs.json',
      'api/_content/navigation/LFNXWhzHT9i98WR3TUdJU1u8pkJNspnHxxR_vHUEFj4.1783624261032/eyJjb2xs.json',
      'api/_content/cache.1783624261032.json'
    ]

    expect(normalizeRouteManifest(files)).toEqual(['index.html'])
  })

  test('keeps the search index at its exact path but drops other api/_content json', () => {
    const files = [
      'api/_content/search/index.json',
      'api/_content/cache.1783624261032.json'
    ]

    expect(normalizeRouteManifest(files)).toEqual(['api/_content/search/index.json'])
  })

  test('keeps nested locale directories intact, sorted lexicographically', () => {
    const files = [
      'de/guide/advanced/index.html',
      'de/guide/deep/nested/index.html',
      'guide/advanced/index.html',
      'guide/deep/nested/index.html'
    ]

    expect(normalizeRouteManifest(files)).toEqual([
      'de/guide/advanced/index.html',
      'de/guide/deep/nested/index.html',
      'guide/advanced/index.html',
      'guide/deep/nested/index.html'
    ])
  })

  test('keeps sitemap index, hreflang child sitemaps, llms*.txt, raw/**.md, and robots.txt', () => {
    const files = [
      'sitemap_index.xml',
      '__sitemap__/en-US.xml',
      '__sitemap__/de-DE.xml',
      '__sitemap__/style.xsl',
      'llms.txt',
      'de/llms.txt',
      'llms-full.txt',
      'raw/guide/getting-started.md',
      'raw/de/leitfaden/erste-schritte.md',
      'robots.txt'
    ]

    expect(normalizeRouteManifest(files)).toEqual([
      '__sitemap__/de-DE.xml',
      '__sitemap__/en-US.xml',
      '__sitemap__/style.xsl',
      'de/llms.txt',
      'llms-full.txt',
      'llms.txt',
      'raw/de/leitfaden/erste-schritte.md',
      'raw/guide/getting-started.md',
      'robots.txt',
      'sitemap_index.xml'
    ])
  })

  test('collapses an entire pagefind/ directory into a single presence marker', () => {
    const files = [
      'index.html',
      'pagefind/pagefind.js',
      'pagefind/pagefind-entry.json',
      'pagefind/fragment/en_1a2b3c.pf_fragment',
      'pagefind/index/en_index.pf_index'
    ]

    expect(normalizeRouteManifest(files)).toEqual(['index.html', 'pagefind/ (present)'])
  })

  test('is deterministic regardless of input order and de-duplicates repeats', () => {
    const files = ['b/index.html', 'a/index.html', 'a/index.html']
    expect(normalizeRouteManifest(files)).toEqual(['a/index.html', 'b/index.html'])
  })

  test('normalizes backslashes and leading ./ so Windows-style listings match POSIX golden files', () => {
    const files = ['.\\guide\\index.html', './guide/index.html']
    expect(normalizeRouteManifest(files)).toEqual(['guide/index.html'])
  })

  test('presenceOnlyDirs is configurable: overriding it stops collapsing pagefind/ and instead collapses the named directory', () => {
    const files = ['pagefind/report.txt', 'other-hash-dir/asset.html']
    expect(normalizeRouteManifest(files, { presenceOnlyDirs: ['other-hash-dir'] })).toEqual([
      'other-hash-dir/ (present)',
      'pagefind/report.txt'
    ])
  })
})

describe('route manifest text formatting (R-2: sorted newline text, not toMatchSnapshot)', () => {
  test('joins entries with a trailing newline', () => {
    expect(formatRouteManifest(['a.html', 'b.html'])).toBe('a.html\nb.html\n')
  })

  test('formats an empty manifest as an empty string', () => {
    expect(formatRouteManifest([])).toBe('')
  })
})
