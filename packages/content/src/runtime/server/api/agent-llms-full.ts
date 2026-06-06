import { defineEventHandler, setHeader } from 'h3'
import { localeFromAgentPath, renderLlmsFullTxt } from '../agent-site'

export default defineEventHandler(async (event) => {
  const path = event.node.req.url?.replace(/\?.*$/, '') || '/'
  const locale = localeFromAgentPath(path)
  setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  return renderLlmsFullTxt(event, locale)
})
