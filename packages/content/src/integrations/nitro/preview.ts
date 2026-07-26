import type { H3Event } from 'h3'
import { createError, getCookie, getHeader, getQuery } from 'h3'
import { getContentRuntimeConfig } from './runtime-config'

const getIncomingPreviewToken = (event: H3Event) => {
  if (!event?.node?.req) return undefined
  if (Object.prototype.hasOwnProperty.call(getQuery(event), 'previewToken')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_preview_transport',
      message: 'Preview credentials are not accepted in query parameters.',
      data: { code: 'invalid_preview_transport' }
    })
  }

  const headerToken = getHeader(event, 'x-nuxt-content-preview')
  if (headerToken) return headerToken
  return event.node?.req?.headers ? getCookie(event, 'previewToken') : undefined
}

const getConfiguredPreviewToken = () => {
  const preview = getContentRuntimeConfig().content?.preview
  return preview && preview !== false && typeof preview.token === 'string' && preview.token.length
    ? preview.token
    : undefined
}

export const isPreview = (event: H3Event) => {
  const configuredToken = getConfiguredPreviewToken()
  const incomingToken = getIncomingPreviewToken(event)
  if (!incomingToken) return false
  if (!configuredToken || incomingToken !== configuredToken) {
    throw createError({
      statusCode: 401,
      statusMessage: 'invalid_preview_token',
      message: 'Invalid content preview credential.',
      data: { code: 'invalid_preview_token' }
    })
  }
  return true
}

export const getPreview = (event: H3Event) => {
  const key = isPreview(event) ? getIncomingPreviewToken(event)! : ''
  return { key }
}
