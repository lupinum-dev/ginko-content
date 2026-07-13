import type { ContentNavigationItem } from '../../types/content'

const itemPath = (item: ContentNavigationItem) => item.path
const searchGroupId = (item: ContentNavigationItem, depth: number, index: number) =>
  `content-search-group:${String(item.canonicalKey || item.stem || `${depth}:${index}`)}`

/**
 * Convert normal content navigation into the leaf-oriented shape expected by
 * Nuxt UI's UContentSearch without mutating the source navigation tree.
 */
export function createContentSearchNavigation (items: ContentNavigationItem[] = [], depth = 0): ContentNavigationItem[] {
  return items.map((item, index) => {
    const children = item.children ? createContentSearchNavigation(item.children, depth + 1) : []
    const path = itemPath(item)
    const hasSelfChild = children.some(child => itemPath(child) === path)
    const normalizedItem = {
      ...item,
      ...(!path ? { searchGroupId: searchGroupId(item, depth, index) } : {})
    }

    return {
      ...normalizedItem,
      children: children.length
        ? [
            ...(path && !hasSelfChild
              ? [{ ...normalizedItem, children: undefined }]
              : []),
            ...children
          ]
        : undefined
    }
  })
}
