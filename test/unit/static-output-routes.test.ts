import { describe, expect, test } from 'vitest'
import {
  collectRawMarkdownLinksFromLlms,
  collectRawMarkdownRoutesFromGeneratedFrontmatter,
  normalizeStaticRoutePath,
  publicOutputPath,
  rawMarkdownIndexRouteForRawRoute,
  rawMarkdownRouteForPageRoute
} from '../../packages/content/src/module/static-output-routes'

describe('static output route helpers', () => {
  test('normalizes public route paths without changing root', () => {
    expect(normalizeStaticRoutePath('')).toBe('/')
    expect(normalizeStaticRoutePath('/')).toBe('/')
    expect(normalizeStaticRoutePath('docs//intro/')).toBe('/docs/intro')
  })

  test('collects only raw markdown links from llms documents', () => {
    const markdown = [
      '[Intro](/raw/docs/intro.md)',
      '[Absolute](https://example.com/raw/blog/post.md)',
      '[Ignored](/docs/intro)',
      '[Also ignored](https://external.test/raw/page.txt)'
    ].join('\n')

    expect(collectRawMarkdownLinksFromLlms(markdown, 'https://example.com')).toEqual([
      '/raw/docs/intro.md',
      '/raw/blog/post.md'
    ])
  })

  test('discovers raw markdown routes from generated page frontmatter and source lines', () => {
    const markdown = [
      'Source: https://example.com/docs/intro',
      '',
      '---',
      'title: Intro',
      'route: "/docs/intro"',
      '---',
      '',
      'Source: /blog/post',
      '',
      '---',
      'title: Post',
      'route: "/blog/post"',
      '---'
    ].join('\n')

    expect(collectRawMarkdownRoutesFromGeneratedFrontmatter(markdown).sort()).toEqual([
      '/raw/blog/post.md',
      '/raw/docs/intro.md'
    ])
  })

  test('maps public page routes and raw markdown routes to generated filenames', () => {
    expect(rawMarkdownRouteForPageRoute('/')).toBe('/raw/index.md')
    expect(rawMarkdownRouteForPageRoute('/docs/intro/')).toBe('/raw/docs/intro.md')
    expect(rawMarkdownIndexRouteForRawRoute('/raw/index.md')).toBe('/index.md')
    expect(rawMarkdownIndexRouteForRawRoute('/raw/docs/intro.md')).toBe('/docs/intro/index.md')
    expect(rawMarkdownIndexRouteForRawRoute('/docs/intro')).toBeNull()
    expect(publicOutputPath('/tmp/public', '/docs/intro')).toBe('/tmp/public/docs/intro')
  })
})
