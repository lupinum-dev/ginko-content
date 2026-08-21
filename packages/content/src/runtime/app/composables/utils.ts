import { createError } from 'h3'
import { withBase } from 'ufo'
import { hash } from 'ohash'
import { tryUseNuxtApp, useRequestEvent, useRequestFetch } from '#imports'
import type { ContentQueryTransportInput } from '../../../types/query'
import { encodeQueryParams } from '../../utils/query'
import { useContentPreview } from './preview'
import { getContentRuntime } from './runtime'

interface ContentRuntimeShape {
  integrity?: string | number
  api: { baseURL: string }
}

const readContentRuntime = (): ContentRuntimeShape => getContentRuntime()

export const withContentBase = (url: string) => withBase(url, readContentRuntime().api.baseURL)

const addPathToEvent = (
  event: NonNullable<ReturnType<typeof useRequestEvent>>,
  path: string
) => {
  event.node.res.setHeader(
    'x-nitro-prerender',
    [
      event.node.res.getHeader('x-nitro-prerender'),
      path
    ].filter(Boolean).join(',')
  )
}

export const createPrerenderPathAdder = (): ((path: string) => void) | undefined => {
  if (import.meta.dev || !import.meta.server) return undefined

  const nuxtApp = tryUseNuxtApp()
  const event = nuxtApp ? useRequestEvent(nuxtApp) : undefined
  return event ? path => addPathToEvent(event, path) : undefined
}

export type ContentApiEndpoint = 'query' | 'navigation'
export type ContentApiFetcher = (request: string, init?: Record<string, unknown>) => Promise<unknown>

export const getPreviewToken = () => useContentPreview().getPreviewToken()

export const getContentApiFetcher = (fetcher?: ContentApiFetcher): ContentApiFetcher => {
  if (fetcher) {
    return fetcher
  }

  if (import.meta.server) {
    return useRequestFetch() as ContentApiFetcher
  }

  return $fetch as unknown as ContentApiFetcher
}

export const buildContentApiPath = (
  endpoint: ContentApiEndpoint,
  params: ContentQueryTransportInput,
  runtime: ContentRuntimeShape
) => {
  const encodedParams = encodeQueryParams(params)
  const requestKey = import.meta.dev ? '_' : `${hash(params)}.${runtime.integrity}`
  return withBase(`/${endpoint}/${requestKey}/${encodedParams}.json`, runtime.api.baseURL)
}

export const isHtmlFallbackResponse = (data: unknown): data is string => {
  return typeof data === 'string' && data.startsWith('<!DOCTYPE html>')
}

export async function fetchContentApi<T> (
  endpoint: ContentApiEndpoint,
  params: ContentQueryTransportInput,
  options: {
    fetcher: ContentApiFetcher
    runtime: ContentRuntimeShape
    previewToken: string | null
    addPrerenderPath?: (path: string) => void
  }
): Promise<T> {
  const apiPath = buildContentApiPath(endpoint, params, options.runtime)
  const data = await options.fetcher(apiPath, {
    method: 'GET',
    responseType: 'json',
    ...(options.previewToken ? { headers: { 'x-nuxt-content-preview': options.previewToken } } : {})
  }) as unknown

  if (isHtmlFallbackResponse(data)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found',
      fatal: true
    })
  }

  if (data === undefined || data === null) {
    throw new TypeError('Invalid content API response: expected a non-empty JSON body.')
  }

  options.addPrerenderPath?.(apiPath)

  return data as T
}
