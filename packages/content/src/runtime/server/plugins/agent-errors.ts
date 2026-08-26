import { getRequestURL } from 'h3'
import { defineNitroPlugin } from 'nitropack/runtime'
import {
  acceptsMarkdown,
  mergeVaryHeader,
  renderAgentNotFoundMarkdown,
  shouldSkipAgentMarkdownPath
} from '../agent-http'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('beforeResponse', (event, response) => {
    const { pathname } = getRequestURL(event)
    if (
      event.node.res.statusCode !== 404
      || shouldSkipAgentMarkdownPath(pathname)
      || !acceptsMarkdown(event)
    ) {
      return
    }

    event.node.res.setHeader('content-type', 'text/markdown; charset=utf-8')
    event.node.res.setHeader('x-robots-tag', 'noindex')
    event.node.res.setHeader('vary', mergeVaryHeader(event.node.res.getHeader('vary'), 'accept'))
    response.body = renderAgentNotFoundMarkdown(pathname)
  })
})
