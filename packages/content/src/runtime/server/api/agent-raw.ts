import { createError, defineEventHandler, setHeader } from 'h3'
import { localeFromAgentPath, resolveMarkdownForPublicRoute, routePathFromRawSlug } from '../agent-site'

export default defineEventHandler(async (event) => {
  const routePath = routePathFromRawSlug(event.context.params?.slug)
  const locale = localeFromAgentPath(routePath)
  const page = await resolveMarkdownForPublicRoute(event, routePath, locale)

  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Markdown page not found' })
  }

  setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  return page.markdown
})
