import type { ContentNavigationItem, ParsedContentMeta } from '../../types/content'
import type { ContentNavigationTreeItem, ResolvedContentNavigationItem } from '../../types/query'

export type ContentNavigationMatch = {
  path?: string
  stem?: string
  title?: string
}

export type NavigationTreeNode = {
  path?: string
  page?: boolean
  children?: readonly NavigationTreeNode[]
}

export type NavigationPageNode<T extends NavigationTreeNode> = T & {
  path: string
}

export const normalizeNavigationPath = (path: string) => path !== '/' && path.endsWith('/') ? path.replace(/\/+$/, '') : path

const stringValue = (value: unknown) => typeof value === 'string' && value.length ? value : undefined

export const getNavigationItemPath = (item: ContentNavigationItem | null | undefined): string | undefined => {
  if (!item || item.page === false) {
    return undefined
  }

  return stringValue(item.path)
}

export const resolveNavigationItem = (item: ContentNavigationItem | null | undefined): ResolvedContentNavigationItem | null => {
  const path = getNavigationItemPath(item)
  return item && path ? { ...item, path } : null
}

const fieldMatches = (item: ContentNavigationItem, field: 'path' | 'unprefixedPath' | 'stem' | 'title', value: string) => {
  const candidate = stringValue(item[field])
  if (!candidate) {
    return false
  }

  if (field === 'path' || field === 'unprefixedPath') {
    return normalizeNavigationPath(candidate) === normalizeNavigationPath(value)
  }

  return candidate === value
}

export const matchesNavigationItem = (item: ContentNavigationItem, match: string | ContentNavigationMatch): boolean => {
  if (typeof match === 'string') {
    return fieldMatches(item, 'path', match)
      || fieldMatches(item, 'unprefixedPath', match)
      || fieldMatches(item, 'stem', match)
      || fieldMatches(item, 'title', match)
  }

  if (match.path && !(fieldMatches(item, 'path', match.path) || fieldMatches(item, 'unprefixedPath', match.path))) {
    return false
  }

  if (match.stem && !fieldMatches(item, 'stem', match.stem)) {
    return false
  }

  if (match.title && !fieldMatches(item, 'title', match.title)) {
    return false
  }

  return Boolean(match.path || match.stem || match.title)
}

export const findFirstNavigationPage = <
  T extends NavigationTreeNode = ContentNavigationTreeItem<ParsedContentMeta>
>(
  items: ReadonlyArray<T> | undefined = []
): NavigationPageNode<T> | null => {
  for (const item of items) {
    if (item.page !== false && typeof item.path === 'string' && item.path.length > 0) {
      return item as NavigationPageNode<T>
    }

    const child = findFirstNavigationPage(item.children as readonly T[] | undefined)
    if (child) {
      return child
    }
  }

  return null
}

export function navigationItemContainsPath<T extends NavigationTreeNode>(
  item: T,
  path: string
): boolean {
  const normalizedPath = normalizeNavigationPath(path)
  return (
    (item.page !== false && typeof item.path === 'string' && normalizeNavigationPath(item.path) === normalizedPath)
    || Boolean(item.children?.some(child => navigationItemContainsPath(child as T, normalizedPath)))
  )
}

export function findNavigationTrail<T extends NavigationTreeNode>(
  items: readonly T[] | undefined,
  path: string
): T[] {
  const normalizedPath = normalizeNavigationPath(path)

  for (const item of items || []) {
    if (item.page !== false && typeof item.path === 'string' && normalizeNavigationPath(item.path) === normalizedPath) {
      return [item]
    }

    const childTrail = findNavigationTrail(item.children as readonly T[] | undefined, normalizedPath)
    if (childTrail.length) {
      return [item, ...childTrail]
    }
  }

  return []
}

/**
 * Visit navigation items in depth-first pre-order. Returning `false` from the
 * visitor skips only the current item's children; it does not abort traversal.
 */
export function walkNavigationTree<T extends NavigationTreeNode>(
  items: readonly T[] | undefined,
  visit: (item: T) => false | undefined
): void {
  for (const item of items || []) {
    const shouldDescend = visit(item)
    if (shouldDescend !== false) {
      walkNavigationTree(item.children as readonly T[] | undefined, visit)
    }
  }
}

export const findFirstNavigationChild = (item: ContentNavigationItem | null | undefined): ResolvedContentNavigationItem | null => {
  return findFirstNavigationPage(item?.children || []) as ResolvedContentNavigationItem | null
}

export const findNavigationItem = (
  items: ContentNavigationItem[] = [],
  match: number | string | ContentNavigationMatch,
  options: { recursive?: boolean } = {}
): ContentNavigationItem | null => {
  if (typeof match === 'number') {
    return items[match] || null
  }

  for (const item of items) {
    if (matchesNavigationItem(item, match)) {
      return item
    }

    if (options.recursive) {
      const child = findNavigationItem(item.children, match, options)
      if (child) {
        return child
      }
    }
  }

  return null
}

export const resolveNavigationPaths = (items: ContentNavigationItem[] = []): string[] => {
  return items
    .map(item => resolveNavigationItem(item)?.path)
    .filter((path): path is string => Boolean(path))
}

export const resolveNavigationFirstPages = (items: ContentNavigationItem[] = []): ResolvedContentNavigationItem[] => {
  return items
    .map(item => resolveNavigationItem(item) || findFirstNavigationChild(item))
    .filter((item): item is ResolvedContentNavigationItem => Boolean(item))
}

export const resolveNavigationFirstChildren = (items: ContentNavigationItem[] = []): ResolvedContentNavigationItem[] => {
  return items
    .map(item => findFirstNavigationChild(item))
    .filter((item): item is ResolvedContentNavigationItem => Boolean(item))
}
