import { withBase } from 'ufo'
import { hash } from 'ohash'
import { useRequestEvent, useRequestFetch } from '#imports'
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

export const navigationDisabled = () => {
  console.warn('Navigation is only accessible when you enable it in module options.')
  console.warn('Learn more in the Ginko navigation documentation.')
  throw new Error('Navigation is only accessible when you enable it in module options.')
}

const lookupRequestEvent = (): { node: { res: { setHeader: (name: string, value: unknown) => void, getHeader: (name: string) => unknown } } } | undefined => {
  try {
    return useRequestEvent() as ReturnType<typeof lookupRequestEvent>
  } catch {
    return undefined
  }
}

const addPathToEvent = (
  event: NonNullable<ReturnType<typeof lookupRequestEvent>>,
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

const createPrerenderPathAdder = (): ((path: string) => void) | undefined => {
  const event = lookupRequestEvent()
  return event ? path => addPathToEvent(event, path) : undefined
}

export const addPrerenderPath = (path: string) => {
  const event = lookupRequestEvent()
  if (event) {
    addPathToEvent(event, path)
  }
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
  params: ContentProviderQueryInput,
  runtime?: ContentRuntimeShape
) => {
  const content = runtime || readContentRuntime()
  const encodedParams = encodeQueryParams(params)
  const requestKey = import.meta.dev ? '_' : `${hash(params)}.${content.integrity}`
  return withBase(`/${endpoint}/${requestKey}/${encodedParams}.json`, content.api.baseURL)
}

export const isHtmlFallbackResponse = (data: unknown): data is string => {
  return typeof data === 'string' && data.startsWith('<!DOCTYPE html>')
}

export async function fetchContentApi<T> (
  endpoint: ContentApiEndpoint,
  params: ContentProviderQueryInput,
  options: {
    fetcher?: ContentApiFetcher
    runtime?: ContentRuntimeShape
    notFoundMessage?: string
    previewToken?: string | null
  } = {}
): Promise<T> {
  const apiPath = buildContentApiPath(endpoint, params, options.runtime)
  const previewToken = options.previewToken === undefined ? getPreviewToken() : options.previewToken
  const addPrerenderPathOnSuccess =
    !import.meta.dev && import.meta.server ? createPrerenderPathAdder() : undefined

  const fetcher = getContentApiFetcher(options.fetcher)
  const data = await fetcher(apiPath, {
    method: 'GET',
    responseType: 'json',
    ...(previewToken ? { headers: { 'x-nuxt-content-preview': previewToken } } : {})
  }) as unknown

  if (isHtmlFallbackResponse(data)) {
    throw new Error(options.notFoundMessage || 'Not found')
  }

  if (!import.meta.dev && import.meta.server) {
    addPrerenderPathOnSuccess?.(apiPath)
  }

  return data as T
}
