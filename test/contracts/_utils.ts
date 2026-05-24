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
  _id: 'content:en:guide:getting-started.md',
  _path: '/guide/getting-started',
  _file: '/en/guide/getting-started.md',
  _source: 'content',
  _type: 'markdown',
  _locale: 'en',
  _canonicalKey: 'guide/getting-started',
  title: 'Getting Started',
  body: { type: 'root', children: [] },
  ...overrides
}) as ParsedContent

export const navDoc = (overrides: Partial<ParsedContent> = {}) => doc({
  title: 'Guide',
  _id: 'content:en:guide:index.md',
  _path: '/guide',
  _file: '/en/guide/index.md',
  _canonicalKey: 'guide',
  ...overrides
})
