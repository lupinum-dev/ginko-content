import type { ContentNavigationItem } from '@lupinum/ginko-content'

const DOCS_BASE_PATH = '/docs'

export function normalizeDocsPath(path: string) {
  if (path === DOCS_BASE_PATH) {
    return '/'
  }

  return path.startsWith(`${DOCS_BASE_PATH}/`)
    ? path.slice(DOCS_BASE_PATH.length)
    : path
}

export function prefixDocsPath(path?: string | null) {
  if (!path) {
    return path
  }

  if (path === '/') {
    return DOCS_BASE_PATH
  }

  return path.startsWith(DOCS_BASE_PATH)
    ? path
    : `${DOCS_BASE_PATH}${path}`
}

export function prefixDocsNavigation(items?: ContentNavigationItem[] | null): ContentNavigationItem[] {
  return (items || []).map(item => ({
    ...item,
    path: prefixDocsPath(typeof item.path === 'string' ? item.path : undefined),
    children: prefixDocsNavigation(Array.isArray(item.children) ? item.children : [])
  }))
}
