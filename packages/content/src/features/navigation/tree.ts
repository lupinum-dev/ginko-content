import type { ContentNavigationItem } from '../../types/content'

export function flattenCollectionNavigation (navigation: ContentNavigationItem[] = []): ContentNavigationItem[] {
  return navigation.flatMap((item) => {
    const children: ContentNavigationItem[] = item.children ? flattenCollectionNavigation(item.children) : []
    if (!item._path && !item.path) {
      return children
    }

    if (item.page === false || (children.length && children.find(child => child._path === item._path))) {
      return children
    }

    return [{ ...item, children: undefined }, ...children]
  })
}

export function createCollectionSurroundings (
  navigation: ContentNavigationItem[] = [],
  path: string,
  options: Partial<{ before: number, after: number }> = {}
) {
  const before = options.before ?? 1
  const after = options.after ?? 1
  const items = flattenCollectionNavigation(navigation)
  const normalizedPath = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path
  const index = items.findIndex((item) => {
    const itemPath = typeof item.path === 'string'
      ? item.path
      : item._path

    if (!itemPath) {
      return false
    }

    const normalizedItemPath = itemPath.endsWith('/') && itemPath !== '/' ? itemPath.slice(0, -1) : itemPath
    return normalizedItemPath === normalizedPath
  })

  const beforeItems = index === -1 ? [] : items.slice(Math.max(0, index - before), index)
  const afterItems = index === -1 ? [] : items.slice(index + 1, index + after + 1)

  return [
    ...(Array.from({ length: before }).fill(null).concat(beforeItems).slice(beforeItems.length)),
    ...afterItems.concat(Array.from({ length: after }).fill(null) as typeof afterItems).slice(0, after)
  ] as Array<ContentNavigationItem | null>
}
