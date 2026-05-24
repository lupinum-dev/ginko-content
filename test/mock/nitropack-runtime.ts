import { vi } from 'vitest'

const readGlobal = <T>(key: string, fallback: T): T =>
  (globalThis as Record<string, T | undefined>)[key] ?? fallback

export const useRuntimeConfig = () => readGlobal('__ginkoTestRuntimeConfig', {})

export const useNitroApp = () => readGlobal('__ginkoTestNitroApp', {
  hooks: {
    callHook: vi.fn()
  }
})

export const useStorage = () => readGlobal('__ginkoTestStorage', {
  getItem: vi.fn(),
  setItem: vi.fn(),
  getKeys: vi.fn(async () => []),
  removeItem: vi.fn()
})

export const defineNitroPlugin = (plugin: unknown) => plugin
