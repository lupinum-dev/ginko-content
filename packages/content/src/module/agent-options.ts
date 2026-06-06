import type { ModuleOptions } from '../types/module'

export const normalizeAgentRouteOptions = (options: ModuleOptions) => {
  if (options.agent === false) {
    return {
      routes: false,
      linkHeaders: false,
      markdownNegotiation: false,
      prerender: false
    }
  }

  return {
    routes: options.agent?.routes !== false,
    linkHeaders: options.agent?.linkHeaders !== false,
    markdownNegotiation: options.agent?.markdownNegotiation !== false,
    prerender: options.agent?.prerender !== false
  }
}
