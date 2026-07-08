import type { ParsedContent } from '../../packages/content/src/types/content'

export const createEvent = () => ({ context: {} }) as any

export const createStorage = <T = any>(initial: Record<string, T> = {}) => {
  const state = new Map<string, T>(Object.entries(initial))

  return {
    async getItem(key: string) {
      return state.get(key) ?? null
    },
    async setItem(key: string, value: T) {
      state.set(key, value)
    },
    async getKeys(prefix = '') {
      return Array.from(state.keys()).filter(key => key.startsWith(prefix))
    },
    async getMeta(key: string) {
      const value = state.get(key) as any
      return value?._meta || null
    },
    async hasItem(key: string) {
      return state.has(key)
    },
    _state: state
  }
}

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
