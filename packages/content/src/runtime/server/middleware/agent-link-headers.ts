import { defineEventHandler, getRequestURL, setHeader } from 'h3'
import { contentConfig } from '../storage-access'

const shouldAdvertise = (pathname: string) =>
  !pathname.startsWith('/_')
  && !pathname.startsWith('/api/')
  && !pathname.endsWith('.css')
  && !pathname.endsWith('.js')
  && !pathname.endsWith('.png')
  && !pathname.endsWith('.jpg')
  && !pathname.endsWith('.jpeg')
  && !pathname.endsWith('.webp')
  && !pathname.endsWith('.svg')
  && !pathname.endsWith('.ico')

export default defineEventHandler((event) => {
  const { pathname } = getRequestURL(event)
  if (!shouldAdvertise(pathname)) return

  const signals = contentConfig().agent?.site?.contentSignals
  if (signals) {
    setHeader(
      event,
      'content-signal',
      [
        `search=${signals.search ? 'yes' : 'no'}`,
        `ai-input=${signals.aiInput ? 'yes' : 'no'}`,
        `ai-train=${signals.aiTrain ? 'yes' : 'no'}`
      ].join(', ')
    )
  }

  setHeader(
    event,
    'link',
    [
      '</llms.txt>; rel="llms"; type="text/markdown"',
      '</llms-full.txt>; rel="alternate"; type="text/markdown"',
      '</sitemap.xml>; rel="sitemap"; type="application/xml"'
    ].join(', ')
  )
})
