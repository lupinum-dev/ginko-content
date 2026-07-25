import { normalizeContentPath } from '../../features/localization/path'
import type { RuntimeContentConfig } from './context'
import { resolveRuntimeCollectionLocalePolicy } from '../localization/config'

const collectionLocalePolicy = (
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => runtime ? resolveRuntimeCollectionLocalePolicy(collection, runtime) : undefined

const collectionRouteRoots = (
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  const policy = collectionLocalePolicy(collection, runtime)
  return new Set(Object.values(policy?.routeMounts || {}).map(value => normalizeContentPath(value)))
}

export const isCollectionRouteRoot = (
  path: string,
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => collectionRouteRoots(collection, runtime).has(normalizeContentPath(path))

const isAncestorRoutePath = (path: string, childPath: string) => {
  const normalized = normalizeContentPath(path)
  const child = normalizeContentPath(childPath)
  return normalized === '/'
    ? child !== '/'
    : child.startsWith(`${normalized}/`)
}

export const isNavigationRootPath = (
  path: string,
  flat: Array<{ path: string, item: unknown }>
) => Boolean(flat[0]?.path && isAncestorRoutePath(path, flat[0].path))
