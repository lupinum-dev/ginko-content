import { createError, defineEventHandler } from 'h3'
import { localeFromAgentPath, renderLlmsTxt, buildAgentPageIndex, isSupportedAgentLocale } from '../agent-site'
import { appendResponseHeader, setAgentMarkdownHeaders } from '../agent-http'

export default defineEventHandler(async (event) => {
  const path = event.node.req.url?.replace(/\?.*$/, '') || '/'
  const explicitLocale = /^\/([^/]+)\/llms\.txt$/i.exec(path)?.[1]
  if (explicitLocale && !isSupportedAgentLocale(explicitLocale)) {
    throw createError({ statusCode: 404, statusMessage: 'Agent locale not found' })
  }
  const locale = localeFromAgentPath(path)
  setAgentMarkdownHeaders(event)
  appendResponseHeader(event, 'link', `<${path.replace(/llms\.txt$/i, 'llms-full.txt')}>; rel="alternate"; type="text/markdown"`)
  return renderLlmsTxt(await buildAgentPageIndex(event, locale), locale)
})
