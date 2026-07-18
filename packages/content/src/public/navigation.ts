/**
 * Runtime-free navigation utilities for themes, tests, and non-Nuxt consumers.
 */
export {
  findFirstNavigationChild,
  findFirstNavigationPage,
  findNavigationTrail,
  navigationItemContainsPath,
  normalizeNavigationPath,
  walkNavigationTree
} from '../features/navigation/resolve.js'

export type {
  NavigationPageNode,
  NavigationTreeNode
} from '../features/navigation/resolve.js'

export type {
  ContentNavigationItem,
  ContentNavigationTreeItem,
  ResolvedContentNavigationItem
} from '../types/query.js'
