import { vi } from 'vitest'

export const addServerHandler = vi.fn()
export const addComponentsDir = vi.fn()
export const addImports = vi.fn()
export const addPlugin = vi.fn()
export const addServerImports = vi.fn()
export const addTemplate = vi.fn()
export const addTypeTemplate = vi.fn()

export const createResolver = () => ({
  resolve: (...parts: string[]) => `/resolved/${parts.join('/')}`,
  resolvePath: vi.fn(async (value: string) => value)
})

export const defineNuxtModule = (definition: any) => definition

export const useLogger = vi.fn(() => ({
  info: vi.fn()
}))
