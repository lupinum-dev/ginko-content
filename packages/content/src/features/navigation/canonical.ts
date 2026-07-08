import type { ContentFileMeta, ContentNavigationItem, NavItem } from '../../types/content'
import { getContentStem, normalizeContentPath, projectContentPathToLocale, type RouteMounts } from '../localization/path'

export type NavigationNodeKind = 'page' | 'folder'

export interface CanonicalNavigationItem {
  title: string
  path?: string
  stem?: string
  page?: false
  id?: string
  canonicalKey?: string
  _locale?: string
  _fallback?: boolean
  draft?: boolean
  file?: ContentFileMeta
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

export const getNavigationIdentity = (node: Pick<CanonicalNavigationItem, 'canonicalKey'>) => {
  if (isString(node.canonicalKey)) {
    return node.canonicalKey
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
  const merged: CanonicalNavigationItem[] = primary.map(item => ({
    ...item,
    ...(item.children ? { children: mergeCanonicalNavigation(item.children, []) } : {})
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

  return Boolean(item.children?.length && !item.id && !item.path)
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

  const rootPath = normalizeRoutePath(root._navigationPath || root.path)
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
    children,
    path,
    stem,
    file,
    _navigationKind,
    _navigationPath,
    _collectionRoot,
    ...fields
  } = item
  void children
  void path
  void stem
  void file
  void _navigationKind
  void _navigationPath
  void _collectionRoot
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

  const rawPath = item._navigationPath || item.path
  if (!rawPath) {
    return {
      ...base,
      ...(hasChildren ? { children } : {})
    } as ContentNavigationItem
  }

  const canonicalPath = normalizeContentPath(rawPath)
  return {
    ...base,
    path: options.canonical
      ? canonicalPath
      : projectContentPathToLocale(canonicalPath, options.locale || item._locale, options.defaultLocale, options.routeMounts),
    canonicalPath,
    stem: item.stem || getContentStem(canonicalPath, item.file?.path),
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
