const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '')

export const normalizeAgentRoutePath = (path: string | undefined) => {
  if (!path || path === '/') return '/'
  return `/${trimSlashes(path.replace(/\/+/g, '/'))}`
}

export const agentMarkdownPathForRoute = (path: string) => {
  const normalized = normalizeAgentRoutePath(path)
  return normalized === '/' ? '/index.md' : `${normalized}/index.md`
}

export const agentRawPathForRoute = (path: string) => {
  const normalized = normalizeAgentRoutePath(path)
  return normalized === '/' ? '/raw/index.md' : `/raw${normalized}.md`
}

export const agentRoutePathFromRawSlug = (slug: string | string[] | undefined) => {
  const joined = Array.isArray(slug) ? slug.join('/') : (slug || '')
  const withoutExtension = joined.replace(/\.md$/i, '')
  if (withoutExtension === 'index') return '/'
  return normalizeAgentRoutePath(withoutExtension.replace(/\/index$/i, '') || '/')
}

export const agentRoutePathFromIndexSlug = (slug: string | string[] | undefined) => {
  const joined = Array.isArray(slug) ? slug.join('/') : (slug || '')
  return normalizeAgentRoutePath(joined || '/')
}
