import { addServerHandler } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import type { ContentSearchOptions, ModuleOptions } from '../types/module'
import { normalizeAgentRouteOptions } from './agent-options'

export const registerContentServerHandlers = (
  nuxt: Nuxt,
  options: ModuleOptions,
  resolveRuntimeModule: (path: string) => string,
  buildIntegrity: number | undefined
) => {
  const revalidate = options.revalidate === false ? undefined : options.revalidate
  const sitemap = options.sitemap === false
    ? false
    : options.sitemap === true
      ? { path: '/sitemap' }
      : options.sitemap

  addServerHandler({
    method: 'get',
    route: `${options.api.baseURL}/query/**:params`,
    handler: resolveRuntimeModule('./server/api/query.js')
  })
  addServerHandler({
    method: 'get',
    route: `${options.api.baseURL}/query`,
    handler: resolveRuntimeModule('./server/api/query.js')
  })
  addServerHandler({
    method: 'get',
    route: `${options.api.baseURL}/locales/:collection`,
    handler: resolveRuntimeModule('./server/api/locales.js')
  })
  addServerHandler({
    method: 'get',
    route: `${options.api.baseURL}/site-data`,
    handler: resolveRuntimeModule('./server/api/site-data.js')
  })
  if (revalidate?.token) {
    addServerHandler({
      method: 'post',
      route: `${options.api.baseURL}/revalidate`,
      handler: resolveRuntimeModule('./server/api/revalidate.js')
    })
  }
  addServerHandler({
    method: 'get',
    route: nuxt.options.dev
      ? `${options.api.baseURL}/cache.json`
      : `${options.api.baseURL}/cache.${buildIntegrity}.json`,
    handler: resolveRuntimeModule('./server/api/cache.js')
  })

  if (sitemap !== false) {
    addServerHandler({
      method: 'get',
      route: `${options.api.baseURL}${sitemap.path || '/sitemap'}`,
      handler: resolveRuntimeModule('./server/api/sitemap.js')
    })
  }

  if (options.navigation) {
    addServerHandler({
      method: 'get',
      route: `${options.api.baseURL}/navigation/**:params`,
      handler: resolveRuntimeModule('./server/api/navigation.js')
    })
    addServerHandler({
      method: 'get',
      route: `${options.api.baseURL}/navigation`,
      handler: resolveRuntimeModule('./server/api/navigation.js')
    })
  }

  const agent = normalizeAgentRouteOptions(options)
  if (agent.routes) {
    addServerHandler({
      method: 'get',
      route: '/llms.txt',
      handler: resolveRuntimeModule('./server/api/agent-llms.js')
    })
    addServerHandler({
      method: 'get',
      route: '/llms-full.txt',
      handler: resolveRuntimeModule('./server/api/agent-llms-full.js')
    })
    addServerHandler({
      method: 'get',
      route: '/:locale/llms.txt',
      handler: resolveRuntimeModule('./server/api/agent-llms.js')
    })
    addServerHandler({
      method: 'get',
      route: '/:locale/llms-full.txt',
      handler: resolveRuntimeModule('./server/api/agent-llms-full.js')
    })
    addServerHandler({
      method: 'get',
      route: '/raw/**:slug',
      handler: resolveRuntimeModule('./server/api/agent-raw.js')
    })
  }
  if (agent.markdownNegotiation) {
    addServerHandler({
      middleware: true,
      handler: resolveRuntimeModule('./server/middleware/agent-markdown.js')
    })
  }
  if (agent.linkHeaders) {
    addServerHandler({
      middleware: true,
      handler: resolveRuntimeModule('./server/middleware/agent-link-headers.js')
    })
  }
}

export const registerContentSearchServerHandlers = (
  apiBaseURL: string,
  search: ContentSearchOptions,
  resolveRuntimeModule: (path: string) => string
) => {
  const searchBaseURL = search.apiBaseURL || `${apiBaseURL.replace(/\/$/, '')}/search`
  const indexURL = `${searchBaseURL.replace(/\/$/, '')}/index.json`

  addServerHandler({
    method: 'get',
    route: searchBaseURL,
    handler: resolveRuntimeModule('./server/api/search.js')
  })
  if (search.engine !== 'cms') {
    addServerHandler({
      method: 'get',
      route: indexURL,
      handler: resolveRuntimeModule('./server/api/search-index.js')
    })
  }
}
