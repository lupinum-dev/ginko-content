import { describe, expect, test } from 'vitest'
import { collectReferencedAssets, measurePageAssetBudget } from '../../scripts/lib/asset-budget.mjs'

describe('docs initial asset budget', () => {
  test('counts referenced scripts and styles once while ignoring lazy chunks', async () => {
    const html = [
      '<script type="module" src="/_nuxt/entry.js"></script>',
      '<link rel="modulepreload" href="/_nuxt/shared.js">',
      '<link rel="stylesheet" href="/_nuxt/app.css">',
      '<script src="/_nuxt/entry.js"></script>'
    ].join('')
    expect(collectReferencedAssets(html)).toEqual(['app.css', 'entry.js', 'shared.js'])

    const sizes = new Map([['entry.js', 1000], ['shared.js', 2000], ['app.css', 3000], ['lazy.js', 1_000_000]])
    const result = await measurePageAssetBudget([{ path: 'index.html', html }], async asset => Buffer.alloc(sizes.get(asset) || 0))
    expect(result.maxPage.path).toBe('index.html')
    expect(result.maxPage.assets).not.toContain('lazy.js')
    expect(result.largestAsset.asset).toBe('app.css')
  })

  test('does not treat lazy data attributes as initial asset references', () => {
    const html = [
      '<script data-src="/_nuxt/lazy.js"></script>',
      '<link rel="modulepreload" data-href="/_nuxt/lazy-preload.js">',
      '<script src="/_nuxt/entry.js"></script>'
    ].join('')

    expect(collectReferencedAssets(html)).toEqual(['entry.js'])
  })

  test('reports the page with the largest referenced gzip payload', async () => {
    const pages = [
      { path: 'small.html', html: '<script src="/_nuxt/small.js"></script>' },
      { path: 'large.html', html: '<script src="/_nuxt/large.js"></script><link rel="stylesheet" href="/_nuxt/app.css">' }
    ]
    const result = await measurePageAssetBudget(pages, async asset => Buffer.from(asset.repeat(asset === 'large.js' ? 500 : 10)))
    expect(result.maxPage.path).toBe('large.html')
  })
})
