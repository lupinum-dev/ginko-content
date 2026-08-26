import { createError, defineEventHandler, setResponseStatus } from 'h3'
import { localeFromAgentPath, resolveMarkdownForPublicRoute } from '../agent-site'
import { addVaryHeader, renderAgentNotFoundMarkdown, setAgentMarkdownHeaders } from '../agent-http'
import { agentRoutePathFromRawSlug, isUnsafeAgentRoutePath } from '../../../features/agent/agent-paths'

export default defineEventHandler(async (event) => {
  const routePath = agentRoutePathFromRawSlug(event.context.params?.slug)
  if (isUnsafeAgentRoutePath(routePath)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid markdown route path' })
  }

  const locale = localeFromAgentPath(routePath)
  const page = await resolveMarkdownForPublicRoute(event, routePath, locale)

  if (!page) {
    setResponseStatus(event, 404, 'Markdown page not found')
    addVaryHeader(event, 'accept')
    setAgentMarkdownHeaders(event, { noindex: true })
    return renderAgentNotFoundMarkdown(routePath)
  }

  addVaryHeader(event, 'accept')
  setAgentMarkdownHeaders(event, { noindex: true })
  return page.markdown
})
