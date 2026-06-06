import { createError, defineEventHandler } from 'h3'
import { localeFromAgentPath, resolveMarkdownForPublicRoute, routePathFromRawSlug } from '../agent-site'
import { setAgentMarkdownHeaders } from '../agent-http'

export default defineEventHandler(async (event) => {
  const routePath = routePathFromRawSlug(event.context.params?.slug)
  const locale = localeFromAgentPath(routePath)
  const page = await resolveMarkdownForPublicRoute(event, routePath, locale)

  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Markdown page not found' })
  }

  setAgentMarkdownHeaders(event, { noindex: true })
  return page.markdown
})
