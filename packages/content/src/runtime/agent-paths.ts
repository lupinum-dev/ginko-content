const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '')

const decodeRoutePath = (path: string) => {
  let decoded = path
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) return decoded
      decoded = next
    } catch {
      return decoded
    }
  }
  return decoded
}

export const isUnsafeAgentRoutePath = (path: string) => {
  const decoded = decodeRoutePath(path)
  if (decoded.includes('\0')) return true
  return decoded.split('/').some(segment => segment === '..')
}

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
