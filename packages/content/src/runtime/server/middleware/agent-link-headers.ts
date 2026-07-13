import { defineEventHandler, getRequestURL, setHeader } from 'h3'
import { getAgentLocales, localeFromAgentPath, resolveMarkdownForPublicRoute } from '../agent-site'
import { agentRawPathForRoute, normalizeAgentRoutePath } from '../../../features/agent/agent-paths'
import { appendResponseHeader } from '../agent-http'
import { contentConfig } from '../storage-access'

const shouldAdvertise = (pathname: string) =>
  !pathname.startsWith('/_')
  && !pathname.startsWith('/api/')
  && !pathname.endsWith('.css')
  && !pathname.endsWith('.js')
  && !pathname.endsWith('.png')
  && !pathname.endsWith('.jpg')
  && !pathname.endsWith('.jpeg')
  && !pathname.endsWith('.webp')
  && !pathname.endsWith('.svg')
  && !pathname.endsWith('.ico')

const canAdvertisePageAlternate = (pathname: string) =>
  !pathname.endsWith('.md')
  && !pathname.endsWith('.txt')
  && !pathname.endsWith('.xml')
  && !pathname.endsWith('.json')

export default defineEventHandler(async (event) => {
  const { pathname } = getRequestURL(event)
  if (!shouldAdvertise(pathname)) return

  const signals = contentConfig().agent?.site?.contentSignals
  if (signals) {
    setHeader(
      event,
      'content-signal',
      [
        `search=${signals.search ? 'yes' : 'no'}`,
        `ai-input=${signals.aiInput ? 'yes' : 'no'}`,
        `ai-train=${signals.aiTrain ? 'yes' : 'no'}`
      ].join(', ')
    )
  }

  const locale = localeFromAgentPath(pathname)
  const defaultLocale = contentConfig().defaultLocale || getAgentLocales()[0]
  const prefix = locale && locale !== defaultLocale ? `/${locale}` : ''
  const page = canAdvertisePageAlternate(pathname)
    ? await resolveMarkdownForPublicRoute(event, pathname, locale)
    : null
  const pagePath = normalizeAgentRoutePath(pathname)
  const pageLinks = page
    ? [
        `<${agentRawPathForRoute(pagePath)}>; rel="alternate"; type="text/markdown"`
      ]
    : []
  appendResponseHeader(
    event,
    'link',
    [
      ...pageLinks,
      `<${prefix}/llms.txt>; rel="llms"; type="text/markdown"`,
      `<${prefix}/llms-full.txt>; rel="alternate"; type="text/markdown"`,
      '</sitemap.xml>; rel="sitemap"; type="application/xml"'
    ].join(', ')
  )
})
