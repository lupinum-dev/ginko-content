import { defineEventHandler, setHeader } from 'h3'
import { localeFromAgentPath, renderLlmsTxt, buildAgentPageIndex } from '../agent-site'

export default defineEventHandler(async (event) => {
  const path = event.node.req.url?.replace(/\?.*$/, '') || '/'
  const locale = localeFromAgentPath(path)
  setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  setHeader(event, 'link', `<${path.replace(/llms\.txt$/i, 'llms-full.txt')}>; rel="alternate"; type="text/markdown"`)
  return renderLlmsTxt(await buildAgentPageIndex(event, locale), locale)
})
