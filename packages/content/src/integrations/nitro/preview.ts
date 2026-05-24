import type { H3Event } from 'h3'
import { getCookie, getHeader, getQuery } from 'h3'
import { getContentRuntimeConfig } from './runtime-config'

const getIncomingPreviewToken = (event: H3Event) => {
  const queryToken = getQuery(event).previewToken
  if (typeof queryToken === 'string') {
    return queryToken
  }

  return getHeader(event, 'x-nuxt-content-preview') || getCookie(event, 'previewToken')
}

const getConfiguredPreviewToken = () => {
  const preview = getContentRuntimeConfig().content?.preview
  return preview && preview !== false && typeof preview.token === 'string' && preview.token.length
    ? preview.token
    : undefined
}

export const isPreview = (event: H3Event) => {
  const configuredToken = getConfiguredPreviewToken()
  return Boolean(configuredToken && getIncomingPreviewToken(event) === configuredToken)
}

export const getPreview = (event: H3Event) => {
  const key = isPreview(event) ? getIncomingPreviewToken(event)! : ''
  return { key }
}
