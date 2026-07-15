import { adapterCacheEvents, providerCacheEvents, publishAuthorName } from '../../cms-store'
import { createError, defineEventHandler, getRequestURL, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ author?: string, name?: string }>(event)
  const payload = publishAuthorName(body.author || 'alice', body.name || 'Alicia')
  const url = getRequestURL(event)
  const origin = `${url.protocol}//${url.host}`

  const response = await fetch(`${origin}/api/_content/revalidate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ginko-revalidate-token': process.env.GINKO_CONTENT_REVALIDATE_TOKEN || 'local-revalidate-secret'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      statusMessage: 'revalidation_failed',
      message: await response.text()
    })
  }

  return {
    payload,
    revalidation: await response.json(),
    providerCacheEvents,
    adapterCacheEvents
  }
})
