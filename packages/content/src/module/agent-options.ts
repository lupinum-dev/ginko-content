import type { ModuleOptions } from '../types/module'

export const normalizeAgentRouteOptions = (options: ModuleOptions) => {
  if (options.agent === false) {
    return {
      routes: false,
      linkHeaders: false,
      delivery: 'static' as const
    }
  }

  return {
    routes: options.agent?.routes !== false,
    linkHeaders: options.agent?.linkHeaders !== false,
    delivery: options.agent?.delivery || 'static'
  }
}
