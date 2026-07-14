import { createRouterMatcher, type RouteRecordRaw } from 'vue-router'
import type { ContentValidationRouteFacts } from '../types/module'

interface NuxtValidationPage {
  path?: string
  name?: string | symbol
  children?: NuxtValidationPage[]
}

const isCatchAll = (path: string) => /\(\.\*\)[*+]?/.test(path) || path.includes(':pathMatch')

const toRouteRecord = (page: NuxtValidationPage): RouteRecordRaw | undefined => {
  if (!page.path) return undefined
  const children = (page.children || []).flatMap(child => {
    const record = toRouteRecord(child)
    return record ? [record] : []
  })
  return {
    path: page.path,
    ...(page.name ? { name: page.name } : {}),
    component: {},
    ...(children.length ? { children } : {})
  }
}

/** Project Nuxt's resolved page tree into serializable facts for Nitro validation. */
export const createContentValidationRouteFacts = (
  pages: NuxtValidationPage[]
): ContentValidationRouteFacts => {
  const records = pages.flatMap(page => {
    const record = toRouteRecord(page)
    return record ? [record] : []
  })
  const matcher = createRouterMatcher(records, {})
  const patterns: ContentValidationRouteFacts['patterns'] = []
  const named: ContentValidationRouteFacts['named'] = {}

  for (const route of matcher.getRoutes()) {
    if (isCatchAll(route.record.path)) continue
    patterns.push({ source: route.re.source, flags: route.re.flags })
    if (typeof route.record.name === 'string') {
      named[route.record.name] = {
        requiredParams: route.keys.filter(key => !key.optional).map(key => String(key.name))
      }
    }
  }

  return {
    patterns: [...new Map(patterns.map(pattern => [`${pattern.source}\0${pattern.flags}`, pattern])).values()],
    named
  }
}
