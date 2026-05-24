import type { ContentNavigationItem, NavItem } from '../../types/content'
import { getContentStem, normalizeContentPath, projectContentPathToLocale, type RouteMounts } from '../localization/path'

export type NavigationNodeKind = 'page' | 'folder'

export interface CanonicalNavigationItem {
  title: string
  path?: string
  _path?: string
  stem?: string
  page?: false
  _id?: string
  _canonicalKey?: string
  _locale?: string
  _fallback?: boolean
  _draft?: boolean
  _file?: string
  _navigationKind?: NavigationNodeKind
  _navigationPath?: string
  _collectionRoot?: string
  children?: CanonicalNavigationItem[]
  [key: string]: unknown
}

export interface ProjectNavigationOptions {
  locale?: string
  defaultLocale?: string
  routeMounts?: RouteMounts
  collection?: string
  canonical?: boolean
}

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export const getNavigationIdentity = (node: Pick<CanonicalNavigationItem, '_canonicalKey' | '_path' | '_id'>) => {
  if (isString(node._canonicalKey)) {
    return node._canonicalKey
  }

  return undefined
}

const cloneFallbackNode = (node: CanonicalNavigationItem): CanonicalNavigationItem => ({
  ...node,
  _fallback: true,
  children: node.children?.map(cloneFallbackNode)
})

export const mergeCanonicalNavigation = (
  primary: CanonicalNavigationItem[] = [],
  fallback: CanonicalNavigationItem[] = []
): CanonicalNavigationItem[] => {
  const merged = primary.map(item => ({
    ...item,
    children: item.children ? mergeCanonicalNavigation(item.children, []) : undefined
  }))
  const index = new Map<string, CanonicalNavigationItem>()

  for (const item of merged) {
    const identity = getNavigationIdentity(item)
    if (identity) {
      index.set(identity, item)
    }
  }

  for (const fallbackItem of fallback) {
    const identity = getNavigationIdentity(fallbackItem)
    if (!identity) {
      merged.push(cloneFallbackNode(fallbackItem))
      continue
    }

    const existing = index.get(identity)
    if (!existing) {
      const clone = cloneFallbackNode(fallbackItem)
      merged.push(clone)
      index.set(identity, clone)
      continue
    }

    for (const [field, value] of Object.entries(fallbackItem)) {
      if (field === 'children') {
        continue
      }

      if (typeof existing[field] === 'undefined' && typeof value !== 'undefined') {
        existing[field] = value
      }
    }

    existing.children = mergeCanonicalNavigation(existing.children || [], fallbackItem.children || [])
  }

  return merged
}

const normalizeRoutePath = (path?: string) => {
  if (!isString(path)) {
    return undefined
  }

  return normalizeContentPath(path)
}

const isFolderNode = (item: CanonicalNavigationItem) => {
  if (item._navigationKind === 'folder') {
    return true
  }

  if (item._navigationKind === 'page') {
    return false
  }

  return Boolean(item.children?.length && !item._id && !item._path && !item.path)
}

const matchesCollectionRootConfig = (
  collection: string,
  root: CanonicalNavigationItem,
  options: Pick<ProjectNavigationOptions, 'routeMounts'>
) => {
  if (!root.children?.length) {
    return false
  }

  const identity = getNavigationIdentity(root)
  if (identity === collection || identity === `/${collection}`) {
    return true
  }

  const rootPath = normalizeRoutePath(root._path || root._navigationPath || root.path)
  if (rootPath === '/' || rootPath === `/${collection}`) {
    return true
  }

  if (rootPath && Object.values(options.routeMounts || {}).map(normalizeContentPath).includes(rootPath)) {
    return true
  }

  return false
}

export const markCollectionNavigationRoot = (
  navigation: CanonicalNavigationItem[] = [],
  collection?: string,
  options: Pick<ProjectNavigationOptions, 'routeMounts'> = {}
): CanonicalNavigationItem[] => {
  if (!collection || navigation.length !== 1) {
    return navigation
  }

  const [root] = navigation
  if (!root || root._collectionRoot === collection || !matchesCollectionRootConfig(collection, root, options)) {
    return navigation
  }

  return [{ ...root, _collectionRoot: collection }]
}

export const scopeNavigationTree = (
  navigation: CanonicalNavigationItem[] = [],
  collection?: string
): CanonicalNavigationItem[] => {
  if (!collection || navigation.length !== 1) {
    return navigation
  }

  const [root] = navigation
  if (!root?.children?.length || root._collectionRoot !== collection) {
    return navigation
  }

  return root.children
}

const publicFields = (item: CanonicalNavigationItem) => {
  const {
    children: _children,
    path: _path,
    _path: _canonicalPath,
    stem: _stem,
    _file: _file,
    _navigationKind: _navigationKind,
    _navigationPath: _navigationPath,
    _collectionRoot: _collectionRoot,
    ...fields
  } = item

  return fields
}

const projectNavigationItem = (
  item: CanonicalNavigationItem,
  options: ProjectNavigationOptions
): ContentNavigationItem => {
  const children = item.children
    ?.map(child => projectNavigationItem(child, options))
    .filter(Boolean)
  const hasChildren = Boolean(children?.length)
  const base = {
    ...publicFields(item),
    _fallback: item._fallback === true
  }

  if (isFolderNode(item)) {
    return {
      ...base,
      ...(hasChildren ? { children } : {})
    } as ContentNavigationItem
  }

  const rawPath = item._path || item._navigationPath || item.path
  if (!rawPath) {
    return {
      ...base,
      ...(hasChildren ? { children } : {})
    } as ContentNavigationItem
  }

  const canonicalPath = normalizeContentPath(rawPath)
  return {
    ...base,
    _path: canonicalPath,
    path: options.canonical
      ? canonicalPath
      : projectContentPathToLocale(canonicalPath, options.locale || item._locale, options.defaultLocale, options.routeMounts),
    canonicalPath,
    stem: item.stem || getContentStem(canonicalPath, item._file),
    ...(hasChildren ? { children } : {})
  } as ContentNavigationItem
}

export const projectNavigationTree = (
  navigation: CanonicalNavigationItem[] | NavItem[] = [],
  options: ProjectNavigationOptions = {}
): ContentNavigationItem[] => {
  return scopeNavigationTree(navigation as CanonicalNavigationItem[], options.collection)
    .map(item => projectNavigationItem(item, options))
}
