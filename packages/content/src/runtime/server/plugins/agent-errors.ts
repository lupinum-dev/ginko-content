import { getRequestURL } from 'h3'
import { defineNitroPlugin } from 'nitropack/runtime'
import {
  acceptsMarkdown,
  mergeVaryHeader,
  renderAgentNotFoundMarkdown,
  shouldSkipAgentMarkdownPath
} from '../agent-http'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (response, { event }) => {
    const { pathname } = getRequestURL(event)
    if (
      response.statusCode !== 404
      || shouldSkipAgentMarkdownPath(pathname)
      || !acceptsMarkdown(event)
    ) {
      return
    }

    response.headers = {
      ...response.headers,
      'content-type': 'text/markdown; charset=utf-8',
      'x-robots-tag': 'noindex',
      'vary': mergeVaryHeader(response.headers?.vary, 'accept')
    }
    response.body = renderAgentNotFoundMarkdown(pathname)
  })
})
