import type { ContentFileMeta, ContentNavigationItem, NavItem } from '../../types/content'
import { getContentStem, normalizeContentPath } from '../localization/path'
import type { ResolvedCollectionLocalePolicy } from '../localization/locale-policy'
import { projectContentRoute } from '../localization/route-projector'

export type NavigationNodeKind = 'page' | 'folder'

export interface CanonicalNavigationItem {
  title: string
  path?: string
  stem?: string
  page?: false
  id?: string
  canonicalKey?: string
  locale?: string
  fallback?: boolean
  draft?: boolean
  file?: ContentFileMeta
  navigationKind?: NavigationNodeKind
  navigationPath?: string
  children?: CanonicalNavigationItem[]
  [key: string]: unknown
}

export interface ProjectNavigationOptions {
  locale?: string
  localePolicy?: ResolvedCollectionLocalePolicy
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
  fallback: true,
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

const isFolderNode = (item: CanonicalNavigationItem) => {
  if (item.navigationKind === 'folder') {
    return true
  }

  if (item.navigationKind === 'page') {
    return false
  }

  return Boolean(item.children?.length && !item.id && !item.path)
}

const publicFields = (item: CanonicalNavigationItem) => {
  const {
    children,
    path,
    stem,
    file,
    navigationKind,
    navigationPath,
    ...fields
  } = item
  void children
  void path
  void stem
  void file
  void navigationKind
  void navigationPath
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
    fallback: item.fallback === true
  }

  if (isFolderNode(item)) {
    return {
      ...base,
      ...(hasChildren ? { children } : {})
    } as ContentNavigationItem
  }

  const rawPath = item.navigationPath || item.path
  if (!rawPath) {
    return {
      ...base,
      ...(hasChildren ? { children } : {})
    } as ContentNavigationItem
  }

  const unprefixedPath = normalizeContentPath(rawPath)
  const locale = options.locale || item.locale || options.localePolicy?.defaultLocale
  if (options.localePolicy && !locale) {
    throw new Error('Navigation projection requires a resolved locale.')
  }
  return {
    ...base,
    path: options.localePolicy
      ? projectContentRoute({ contentPath: unprefixedPath, locale: locale! }, options.localePolicy)
      : unprefixedPath,
    unprefixedPath,
    stem: item.stem || getContentStem(unprefixedPath, item.file?.path),
    ...(hasChildren ? { children } : {})
  } as ContentNavigationItem
}

export const projectNavigationTree = (
  navigation: CanonicalNavigationItem[] | NavItem[] = [],
  options: ProjectNavigationOptions = {}
): ContentNavigationItem[] => {
  return (navigation as CanonicalNavigationItem[]).map(item => projectNavigationItem(item, options))
}
