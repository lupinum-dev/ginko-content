import { join } from 'pathe'

export const normalizeStaticRoutePath = (path: string) => {
  if (!path || path === '/') return '/'
  return `/${path.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')}`
}

export const collectRawMarkdownLinksFromLlms = (markdown: string, siteUrl: string | undefined) => {
  const links = new Set<string>()
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g
  for (const match of markdown.matchAll(pattern)) {
    const href = match[1]
    if (!href) continue
    try {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(href)
        ? new URL(href)
        : new URL(href, siteUrl || 'http://localhost:3000')
      if (url.pathname.startsWith('/raw/') && url.pathname.endsWith('.md')) links.add(url.pathname)
    } catch {
      if (href.startsWith('/raw/') && href.endsWith('.md')) links.add(href)
    }
  }
  return Array.from(links)
}

export const rawMarkdownRouteForPageRoute = (route: string) => {
  const normalized = normalizeStaticRoutePath(route)
  return normalized === '/' ? '/raw/index.md' : `/raw${normalized}.md`
}

export const collectRawMarkdownRoutesFromGeneratedFrontmatter = (markdown: string) => {
  const links = new Set<string>()
  const addRoutePath = (route: string) => {
    links.add(rawMarkdownRouteForPageRoute(route))
  }
  const addFrontmatterRoute = (frontmatter: string | undefined) => {
    const route = /^route:\s*"([^"]+)"/m.exec(frontmatter || '')?.[1]
    if (!route) return
    addRoutePath(route)
  }
  const addSourceRoute = (source: string | undefined) => {
    if (!source) return
    try {
      addRoutePath(new URL(source, 'http://localhost:3000').pathname)
    } catch {
      addRoutePath(source)
    }
  }

  const sourcePattern = /^Source:\s+(\S+)/gm
  for (const match of markdown.matchAll(sourcePattern)) {
    addSourceRoute(match[1])
  }

  const pageFrontmatterPattern = /^Source:\s+[^\n]+\n\n---\n([\s\S]*?)\n---/gm
  for (const match of markdown.matchAll(pageFrontmatterPattern)) {
    addFrontmatterRoute(match[1])
  }

  const firstFrontmatter = /^---\n([\s\S]*?)\n---/.exec(markdown)?.[1]
  addFrontmatterRoute(firstFrontmatter)

  return Array.from(links)
}

export const publicOutputPath = (publicDir: string, route: string) =>
  join(publicDir, normalizeStaticRoutePath(route).replace(/^\//, ''))
