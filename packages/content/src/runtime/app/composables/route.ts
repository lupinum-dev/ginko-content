import { computed, onScopeDispose, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { ContentPageResult, ContentRouteMeta } from '../../../types/query'
import { useRoute, useRouter, useState } from '#imports'
import { useRouteBaseName, useSetI18nParams, useSwitchLocalePath } from './content-i18n'

type I18nRouteParams = Record<string, Record<string, unknown>>
type ContentRouteValue = ContentRouteMeta | ContentPageResult | null | undefined
type ActiveContentRoute = {
  token: string
  path?: string
  canonicalPath?: string
  // ADR-0016 changed `localePaths` to a per-locale entry object, but the
  // legacy `useContentRoute` consumers still expect string paths. Normalize
  // to strings here when reading.
  localePaths: Record<string, string>
}
type PublishedContentRoute = ActiveContentRoute & {
  localeParams: I18nRouteParams
  order: number
}

const CONTENT_ROUTE_META_KEY = '__nuxt_content_route'
const CONTENT_ROUTE_REGISTRY_KEY = '__nuxt_content_route_registry'
const CONTENT_ROUTE_STATE_KEY = 'nuxt-content-route'
// App-local monotonic ids keep concurrent page/layout publishers ordered.
// This state never crosses into Nitro request handling.
let contentRouteTokenId = 0

const getRouteMetaState = (meta: Record<string, unknown>) => meta[CONTENT_ROUTE_META_KEY] as ActiveContentRoute | undefined
const getRoutePublisherRegistry = (meta: Record<string, unknown>) => meta[CONTENT_ROUTE_REGISTRY_KEY] as Record<string, PublishedContentRoute> | undefined
const getActiveRoutePublisher = (meta: Record<string, unknown>) => {
  const registry = getRoutePublisherRegistry(meta)
  if (!registry) {
    return undefined
  }

  return Object.values(registry).sort((left, right) => right.order - left.order)[0]
}
const syncPublishedContentRoute = (meta: Record<string, unknown>, setI18nParams: (params: I18nRouteParams) => void) => {
  const activePublisher = getActiveRoutePublisher(meta)
  if (!activePublisher) {
    Reflect.deleteProperty(meta, CONTENT_ROUTE_META_KEY)
    Reflect.deleteProperty(meta, CONTENT_ROUTE_REGISTRY_KEY)
    setI18nParams({})
    return
  }

  meta[CONTENT_ROUTE_META_KEY] = {
    token: activePublisher.token,
    path: activePublisher.path,
    canonicalPath: activePublisher.canonicalPath,
    localePaths: activePublisher.localePaths
  } satisfies ActiveContentRoute
  setI18nParams(activePublisher.localeParams)
}
const useActiveContentRouteState = () => useState<ActiveContentRoute | null>(CONTENT_ROUTE_STATE_KEY, () => null)
const normalizeRouteParams = (params: Record<string, unknown>) => {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined)
  )
}

const normalizeContentRoute = (value: ContentRouteValue): Omit<ActiveContentRoute, 'token'> | null => {
  if (!value) {
    return null
  }

  // Translate the new `Record<string, LocalePathEntry>` shape down to plain
  // strings for the legacy `useContentRoute` callers.
  const stringPaths: Record<string, string> = {}
  for (const [locale, entry] of Object.entries(value.localePaths || {})) {
    stringPaths[locale] = typeof entry === 'string' ? entry : entry.path
  }

  return {
    path: value.path,
    canonicalPath: value.canonicalPath,
    localePaths: stringPaths
  }
}

const normalizeLocalePath = (entry: string | { path?: string } | undefined) =>
  typeof entry === 'string' ? entry : entry?.path

const normalizeRoutePath = (path: unknown) => {
  if (typeof path !== 'string') return undefined
  const normalized = path.replace(/\/+$/, '')
  return normalized || '/'
}

const contentRouteMatches = (contentRoute: Pick<ActiveContentRoute, 'path' | 'canonicalPath' | 'localePaths'>, path: string) => {
  const normalizedPath = normalizeRoutePath(path)
  return normalizeRoutePath(contentRoute.path) === normalizedPath ||
    normalizeRoutePath(contentRoute.canonicalPath) === normalizedPath ||
    Object.values(contentRoute.localePaths).some(localePath => normalizeRoutePath(localePath) === normalizedPath)
}

const resolveLocalizedRouteParams = (
  page: ContentRouteValue,
  router: ReturnType<typeof useRouter>,
  route: ReturnType<typeof useRoute>,
  getRouteBaseName: ReturnType<typeof useRouteBaseName>
) => {
  if (!page) {
    return {}
  }

  const baseName = getRouteBaseName(route)
  return Object.fromEntries(
    Object.entries(page.localePaths || {}).map(([locale, entry]) => {
      const path = normalizeLocalePath(entry)
      if (!path) {
        return [locale, {}]
      }

      const resolvedRoute = router.resolve(path)
      const resolvedBaseName = getRouteBaseName(resolvedRoute)

      if (baseName && resolvedBaseName && resolvedBaseName !== baseName) {
        return [locale, {}]
      }

      return [locale, normalizeRouteParams(resolvedRoute.params as Record<string, unknown>)]
    })
  ) as I18nRouteParams
}

export function useContentSwitchLocalePath(): (locale: string) => string {
  const route = useRoute()
  const switchLocalePath = useSwitchLocalePath()
  const activeContentRoute = useActiveContentRouteState()

  return (locale: string) => {
    const active = activeContentRoute.value
    const contentRoute =
      active &&
      contentRouteMatches(active, route.path)
        ? active
        : getRouteMetaState(route.meta as Record<string, unknown>)
    return contentRoute?.localePaths[locale] || switchLocalePath(locale)
  }
}

export function useContentRoute(
  value: MaybeRefOrGetter<ContentRouteValue>
): {
  switchLocalePath: (locale: string) => string
  localePaths: ComputedRef<Record<string, string>>
  canonicalPath: ComputedRef<string | undefined>
  path: ComputedRef<string | undefined>
} {
  const route = useRoute()
  const router = useRouter()
  const getRouteBaseName = useRouteBaseName()
  const setI18nParams = useSetI18nParams()
  const activeContentRouteState = useActiveContentRouteState()
  const token = `content-route:${++contentRouteTokenId}`
  const order = contentRouteTokenId

  const activeContentRoute = computed(() => {
    const contentRoute = normalizeContentRoute(toValue(value))
    if (!contentRoute || !contentRouteMatches(contentRoute, route.path)) {
      return null
    }

    return {
      ...contentRoute,
      token
    } satisfies ActiveContentRoute
  })

  const localeParams = computed(() => {
    const contentRoute = toValue(value)
    const normalizedContentRoute = normalizeContentRoute(contentRoute)
    if (!normalizedContentRoute || !contentRouteMatches(normalizedContentRoute, route.path)) {
      return {}
    }

    return resolveLocalizedRouteParams(contentRoute, router, route, getRouteBaseName)
  })

  watch([activeContentRoute, localeParams], ([contentRoute, params]) => {
    const meta = router.currentRoute.value.meta as Record<string, unknown>
    const registry = getRoutePublisherRegistry(meta) || {}

    if (contentRoute) {
      registry[token] = {
        ...contentRoute,
        localeParams: params,
        order
      }
      meta[CONTENT_ROUTE_REGISTRY_KEY] = registry
    } else {
      Reflect.deleteProperty(registry, token)
    }

    syncPublishedContentRoute(meta, setI18nParams)
    activeContentRouteState.value = getRouteMetaState(meta) ?? null
  // Layouts can render switchers before the page slot. Publish immediately so
  // SSR links in those layouts see the active content route in the same pass.
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(() => {
    const meta = router.currentRoute.value.meta as Record<string, unknown>
    const registry = getRoutePublisherRegistry(meta)

    if (registry) {
      Reflect.deleteProperty(registry, token)
    }

    syncPublishedContentRoute(meta, setI18nParams)
    activeContentRouteState.value = getRouteMetaState(meta) ?? null
  })

  return {
    switchLocalePath: useContentSwitchLocalePath(),
    localePaths: computed(() => activeContentRoute.value?.localePaths || {}),
    canonicalPath: computed(() => activeContentRoute.value?.canonicalPath),
    path: computed(() => activeContentRoute.value?.path)
  }
}
