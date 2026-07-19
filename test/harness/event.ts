import type { ContentProvider } from '../../packages/content/src/public/provider'
import type { ContentScenario } from './content-scenario'

export interface TestEventOptions {
  scenario?: ContentScenario
  provider?: ContentProvider
  query?: Record<string, unknown>
  params?: Record<string, string>
  headers?: Record<string, string>
  context?: Record<string, unknown>
}

export const createTestEvent = (options: TestEventOptions = {}) => {
  const responseHeaders = new Map<string, unknown>()
  return ({
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
        : '/',
      headers: options.headers || {}
    },
    res: {
      setHeader: (name: string, value: unknown) => responseHeaders.set(name.toLowerCase(), value),
      getHeader: (name: string) => responseHeaders.get(name.toLowerCase()),
    },
  },
  web: {
    request: new Request('http://content.local/', { headers: options.headers })
  },
  responseHeaders,
  }) as any
}
