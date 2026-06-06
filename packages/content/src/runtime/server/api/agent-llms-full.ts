import { createError, defineEventHandler } from 'h3'
import { isSupportedAgentLocale, localeFromAgentPath, renderLlmsFullTxt } from '../agent-site'
import { setAgentMarkdownHeaders } from '../agent-http'

export default defineEventHandler(async (event) => {
  const path = event.node.req.url?.replace(/\?.*$/, '') || '/'
  const explicitLocale = /^\/([^/]+)\/llms-full\.txt$/i.exec(path)?.[1]
  if (explicitLocale && !isSupportedAgentLocale(explicitLocale)) {
    throw createError({ statusCode: 404, statusMessage: 'Agent locale not found' })
  }
  const locale = localeFromAgentPath(path)
  setAgentMarkdownHeaders(event)
  return renderLlmsFullTxt(event, locale)
})
