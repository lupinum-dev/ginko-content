import type { ParsedContent } from '../../packages/content/src/types/content'

export const doc = (overrides: Partial<ParsedContent> = {}): ParsedContent => ({
  id: 'content:en:guide:getting-started.md',
  path: '/guide/getting-started',
  file: {
    source: 'content',
    path: '/en/guide/getting-started.md',
    stem: 'en/guide/getting-started',
    extension: 'md'
  },
  type: 'markdown',
  locale: 'en',
  canonicalKey: 'guide/getting-started',
  title: 'Getting Started',
  body: { type: 'root', children: [] },
  ...overrides
}) as ParsedContent

export const navDoc = (overrides: Partial<ParsedContent> = {}) => doc({
  title: 'Guide',
  id: 'content:en:guide:index.md',
  path: '/guide',
  file: {
    source: 'content',
    path: '/en/guide/index.md',
    stem: 'en/guide/index',
    extension: 'md'
  },
  canonicalKey: 'guide',
  ...overrides
})
