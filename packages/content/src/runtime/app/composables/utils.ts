import { createError } from 'h3'
import { withBase } from 'ufo'
import { hash } from 'ohash'
import { tryUseNuxtApp, useRequestEvent, useRequestFetch } from '#imports'
import type { ContentProviderQueryInput } from '../../../types/query'
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

/**
 * Encoded-param length above which queries switch from the cacheable GET
 * path-segment transport to POST with a JSON body. The threshold stays well
 * under practical proxy/WAF URL limits (~8k) so long-tail infrastructure
 * never sees an oversized URL.
 */
export const MAX_GET_QUERY_PARAM_CHARS = 1_500

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

export const isHtmlFallbackResponse = (data: unknown): data is string => {
  return typeof data === 'string' && data.startsWith('<!DOCTYPE html>')
}

export async function fetchContentApi<T> (
  endpoint: ContentApiEndpoint,
  params: ContentProviderQueryInput,
  options: {
    fetcher: ContentApiFetcher
    runtime: ContentRuntimeShape
    previewToken: string | null
    addPrerenderPath?: (path: string) => void
  }
): Promise<T> {
  const encodedParams = encodeQueryParams(params)
  const usePost = encodedParams.length > MAX_GET_QUERY_PARAM_CHARS

  let apiPath: string
  let requestInit: Record<string, unknown>
  if (usePost) {
    // Large queries ride POST with a JSON body. They cannot be prerender-
    // seeded (no stable URL to register), so the prerender-path writer is
    // deliberately skipped.
    apiPath = withBase(`/${endpoint}`, options.runtime.api.baseURL)
    requestInit = {
      method: 'POST',
      body: params,
      responseType: 'json'
    }
  } else {
    const requestKey = import.meta.dev ? '_' : `${hash(params)}.${options.runtime.integrity}`
    apiPath = withBase(`/${endpoint}/${requestKey}/${encodedParams}.json`, options.runtime.api.baseURL)
    requestInit = { method: 'GET', responseType: 'json' }
  }

  if (options.previewToken) {
    requestInit.headers = { 'x-nuxt-content-preview': options.previewToken }
  }

  const data = await options.fetcher(apiPath, requestInit) as unknown

  if (isHtmlFallbackResponse(data)) {
    // A static host answered with the SPA shell instead of a JSON payload.
    // Model that as a 404 so `isNotFoundError` recognizes it and query verbs
    // resolve to `null`/`[]` exactly like a live 404 from the API route.
    throw createError({
      statusCode: 404,
      statusMessage: 'Content not found',
      fatal: true
    })
  }

  if (data === undefined || data === null) {
    throw new TypeError('Invalid content API response: expected a non-empty JSON body.')
  }

  if (!usePost) {
    options.addPrerenderPath?.(apiPath)
  }

  return data as T
}
