import { defineEventHandler, getRequestURL } from 'h3'
import {
  buildAgentPageIndex,
  getAgentLocales,
  localeFromAgentPath,
  renderLlmsTxt,
  resolveMarkdownForPublicRoute
} from '../agent-site'
import { acceptsMarkdown, addVaryHeader, setAgentMarkdownHeaders } from '../agent-http'

const shouldSkip = (pathname: string) =>
  pathname.startsWith('/_')
  || pathname.startsWith('/api/')
  || pathname.startsWith('/raw/')
  || pathname === '/robots.txt'
  || pathname === '/sitemap.xml'
  || pathname.endsWith('.txt')
  || pathname.endsWith('.xml')
  || pathname.endsWith('.json')
  || pathname.endsWith('.ico')
  || pathname.endsWith('.png')
  || pathname.endsWith('.jpg')
  || pathname.endsWith('.jpeg')
  || pathname.endsWith('.webp')
  || pathname.endsWith('.svg')
  || pathname.endsWith('.css')
  || pathname.endsWith('.js')

export default defineEventHandler(async (event) => {
  const { pathname } = getRequestURL(event)
  if (shouldSkip(pathname)) return
  addVaryHeader(event, 'accept')

  if (pathname.endsWith('/index.md')) {
    const routePath = pathname.replace(/\/index\.md$/i, '') || '/'
    const locale = localeFromAgentPath(routePath)
    const page = await resolveMarkdownForPublicRoute(event, routePath, locale)
    if (!page) return
    setAgentMarkdownHeaders(event, { noindex: true })
    return page.markdown
  }

  if (!acceptsMarkdown(event)) return

  if (pathname === '/' || getAgentLocales().some(locale => pathname === `/${locale}`)) {
    const locale = localeFromAgentPath(pathname)
    setAgentMarkdownHeaders(event)
    return renderLlmsTxt(await buildAgentPageIndex(event, locale), locale)
  }

  const locale = localeFromAgentPath(pathname)
  const page = await resolveMarkdownForPublicRoute(event, pathname, locale)
  if (page) {
    setAgentMarkdownHeaders(event)
    return page.markdown
  }
})
