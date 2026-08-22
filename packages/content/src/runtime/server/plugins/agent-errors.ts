import { getRequestURL } from 'h3'
import { defineNitroPlugin } from 'nitropack/runtime'
import {
  acceptsMarkdown,
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

    const vary = new Set(
      String(response.headers?.vary || '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
    )
    vary.add('accept')

    response.headers = {
      ...response.headers,
      'content-type': 'text/markdown; charset=utf-8',
      'x-robots-tag': 'noindex',
      'vary': Array.from(vary).join(', ')
    }
    response.body = renderAgentNotFoundMarkdown(pathname)
  })
})
