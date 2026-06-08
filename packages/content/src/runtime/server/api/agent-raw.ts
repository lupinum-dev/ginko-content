import { createError, defineEventHandler } from 'h3'
import { localeFromAgentPath, resolveMarkdownForPublicRoute, routePathFromRawSlug } from '../agent-site'
import { setAgentMarkdownHeaders } from '../agent-http'
import { isUnsafeAgentRoutePath } from '../../agent-paths'

export default defineEventHandler(async (event) => {
  const routePath = routePathFromRawSlug(event.context.params?.slug)
  if (isUnsafeAgentRoutePath(routePath)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid markdown route path' })
  }

  const locale = localeFromAgentPath(routePath)
  const page = await resolveMarkdownForPublicRoute(event, routePath, locale)

  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Markdown page not found' })
  }

  setAgentMarkdownHeaders(event, { noindex: true })
  return page.markdown
})
