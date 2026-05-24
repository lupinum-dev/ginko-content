import type { ContentProvider } from '../../packages/content/src/public/provider'
import type { ContentScenario } from './content-scenario'

export interface TestEventOptions {
  scenario?: ContentScenario
  provider?: ContentProvider
  query?: Record<string, unknown>
  params?: Record<string, string>
  context?: Record<string, unknown>
}

export const createTestEvent = (options: TestEventOptions = {}) => ({
  path: options.query
    ? `/?${new URLSearchParams(Object.entries(options.query).map(([key, value]) => [key, String(value)])).toString()}`
    : '/',
  context: {
    ...(options.scenario
      ? {
          contentRuntime: {
            ...options.scenario.runtime,
            provider: options.provider?.name || 'in-memory'
          },
          contentProvider: options.provider
        }
      : {}),
    ...(options.params ? { params: options.params } : {}),
    ...options.context
  },
  node: {
    req: {
      url: options.query
        ? `/?${new URLSearchParams(Object.entries(options.query).map(([key, value]) => [key, String(value)])).toString()}`
        : '/'
    }
  }
}) as any
