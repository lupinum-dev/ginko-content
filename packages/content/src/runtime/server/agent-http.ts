import type { H3Event } from 'h3'
import { getHeader, setHeader } from 'h3'

export const shouldSkipAgentMarkdownPath = (pathname: string) =>
  pathname.startsWith('/_')
  || pathname.startsWith('/api/')
  || pathname.startsWith('/raw/')
  || pathname === '/robots.txt'
  || pathname === '/sitemap.xml'
  || pathname.endsWith('.txt')
  || pathname.endsWith('.xml')
  || pathname.endsWith('.json')
  || pathname.endsWith('.ico')
  || pathname.endsWith('.png')
  || pathname.endsWith('.jpg')
  || pathname.endsWith('.jpeg')
  || pathname.endsWith('.webp')
  || pathname.endsWith('.svg')
  || pathname.endsWith('.css')
  || pathname.endsWith('.js')

export const renderAgentNotFoundMarkdown = (pathname: string) => {
  const safePath = pathname.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
  return [
    '# Page not found',
    '',
    `No public page exists at \`${safePath}\`.`,
    '',
    '## Where to look next',
    '',
    '- [Agent content index](/llms.txt)',
    '- [Complete agent content](/llms-full.txt)',
    '- [Homepage](/)',
    ''
  ].join('\n')
}

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

export const mergeVaryHeader = (current: unknown, value: string) => {
  const entries = new Set(
    (typeof current === 'string' ? current : Array.isArray(current) ? current.join(',') : '')
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean)
  )
  entries.add(value.toLowerCase())
  return Array.from(entries).join(', ')
}

export const addVaryHeader = (event: H3Event, value: string) => {
  setHeader(event, 'vary', mergeVaryHeader(event.node.res.getHeader('vary'), value))
}

const parseAcceptPart = (part: string) => {
  const [type = '', ...params] = part.split(';').map(value => value.trim())
  const qParam = params.find(param => param.toLowerCase().startsWith('q='))
  const q = qParam ? Number(qParam.slice(2)) : 1
  return {
    type: type.toLowerCase(),
    q: Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0
  }
}

const effectiveAcceptQuality = (
  entries: Array<{ type: string, q: number }>,
  mediaType: string
) => {
  const [targetType] = mediaType.split('/')
  const matches = entries
    .map((entry) => {
      if (entry.type === mediaType) return { ...entry, specificity: 2 }
      if (entry.type === `${targetType}/*`) return { ...entry, specificity: 1 }
      if (entry.type === '*/*') return { ...entry, specificity: 0 }
      return null
    })
    .filter((entry): entry is { type: string, q: number, specificity: number } => Boolean(entry))

  if (!matches.length) return 0
  const specificity = Math.max(...matches.map(entry => entry.specificity))
  return matches
    .filter(entry => entry.specificity === specificity)
    .reduce((maximum, entry) => Math.max(maximum, entry.q), 0)
}

export const acceptsMarkdown = (event: H3Event) => {
  const accept = getHeader(event, 'accept')
  if (!accept) return false

  const entries = accept
    .split(',')
    .map(parseAcceptPart)
  if (!entries.some(entry => entry.type === 'text/markdown' && entry.q > 0)) return false

  const markdownQ = effectiveAcceptQuality(entries, 'text/markdown')
  const htmlQ = Math.max(
    effectiveAcceptQuality(entries, 'text/html'),
    effectiveAcceptQuality(entries, 'application/xhtml+xml')
  )

  return markdownQ > 0 && markdownQ >= htmlQ
}

export const setAgentMarkdownHeaders = (event: H3Event, options: { noindex?: boolean } = {}) => {
  setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  if (options.noindex) setHeader(event, 'x-robots-tag', 'noindex')
}
