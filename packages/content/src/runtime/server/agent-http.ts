import type { H3Event } from 'h3'
import { getHeader, setHeader } from 'h3'

export const appendResponseHeader = (event: H3Event, name: string, value: string) => {
  const current = event.node.res.getHeader(name)
  const existing = Array.isArray(current)
    ? current.filter(Boolean).join(', ')
    : typeof current === 'number'
      ? String(current)
      : typeof current === 'string'
        ? current
        : ''

  setHeader(event, name, existing ? `${existing}, ${value}` : value)
}

export const addVaryHeader = (event: H3Event, value: string) => {
  const current = event.node.res.getHeader('vary')
  const entries = new Set(
    (typeof current === 'string' ? current : Array.isArray(current) ? current.join(',') : '')
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean)
  )
  entries.add(value.toLowerCase())
  setHeader(event, 'vary', Array.from(entries).join(', '))
}

const parseAcceptPart = (part: string) => {
  const [type = '', ...params] = part.split(';').map(value => value.trim())
  const qParam = params.find(param => param.toLowerCase().startsWith('q='))
  const q = qParam ? Number(qParam.slice(2)) : 1
  return {
    type: type.toLowerCase(),
    q: Number.isFinite(q) ? q : 0
  }
}

export const acceptsMarkdown = (event: H3Event) => {
  const accept = getHeader(event, 'accept')
  if (!accept) return false

  const entries = accept
    .split(',')
    .map(parseAcceptPart)
    .filter(entry => entry.q > 0)
  const markdownQ = entries
    .filter(entry => entry.type === 'text/markdown')
    .reduce((max, entry) => Math.max(max, entry.q), 0)
  if (!markdownQ) return false

  const htmlQ = entries
    .filter(entry => entry.type === 'text/html' || entry.type === 'application/xhtml+xml')
    .reduce((max, entry) => Math.max(max, entry.q), 0)

  return markdownQ >= htmlQ
}

export const setAgentMarkdownHeaders = (event: H3Event, options: { noindex?: boolean } = {}) => {
  setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  if (options.noindex) setHeader(event, 'x-robots-tag', 'noindex')
}
