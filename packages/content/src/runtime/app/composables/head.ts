import type { RouteLocationNormalized, RouteLocationNormalizedLoaded } from 'vue-router'
import type { Ref } from 'vue'
import { hasProtocol, joinURL, withoutTrailingSlash } from 'ufo'
import { useRoute, nextTick, useHead, unref, watch, useRuntimeConfig } from '#imports'

type ContentHeadObject = {
  title?: string
  description?: string
  image?: string | Record<string, any>
  meta?: Array<Record<string, any>>
  link?: Array<Record<string, any>>
  [key: string]: any
}

type ContentHeadDocument = {
  title?: string
  description?: string
  image?: string | Record<string, any>
  head?: ContentHeadObject
  seo?: ContentHeadObject
}

type ContentHeadRuntimeConfig = {
  app: { baseURL: string }
  public: { siteUrl?: unknown }
}

function isHeadImageObject (image: unknown): image is Record<string, any> {
  return typeof image === 'object' && image !== null
}

/**
 * Apply sensible page head defaults from a parsed content document.
 *
 * The composable merges explicit `content.head` or `content.seo` values with common fallbacks
 * from the document (`title`, `description`, `image`) and adds canonical /
 * Open Graph URL metadata when a public site URL is configured.
 */
export const useContentHead = (
  _content: ContentHeadDocument | null | undefined | Ref<ContentHeadDocument | null | undefined>,
  to: RouteLocationNormalized | RouteLocationNormalizedLoaded = useRoute()
) => {
  const config = useRuntimeConfig()
  const applyHead = (head: ContentHeadObject) => useHead(head as Parameters<typeof useHead>[0])

  const refreshHead = (data: ContentHeadDocument | null | undefined = unref(_content)) => {
    const head = resolveContentHead(data, to, config as ContentHeadRuntimeConfig)
    if (!head) return

    if (import.meta.client) { nextTick(() => applyHead(head)) } else { applyHead(head) }
  }

  watch(() => unref(_content), refreshHead, { immediate: true })
}

export const resolveContentHead = (
  data: ContentHeadDocument | null | undefined,
  to: Pick<RouteLocationNormalized | RouteLocationNormalizedLoaded, 'path' | 'fullPath'>,
  config: ContentHeadRuntimeConfig
): ContentHeadObject | null => {
  // Don't call this function if no route is yet available
  if (!to.path || !data) { return null }

  // Default head to `data.head`, with `data.seo` supported for Nuxt UI content.
  const head: ContentHeadObject = Object.assign({}, data?.head || data?.seo || {})
  const appConfig = config.app

  head.meta = [...(head.meta || [])]
  head.link = [...(head.link || [])]

  const title = head.title || data?.title
  if (title) {
    head.title = title
    if (import.meta.server && !head.meta.some(m => m.property === 'og:title')) {
      head.meta.push({
        property: 'og:title',
        content: title
      })
    }
  }

  const siteUrl = typeof config.public.siteUrl === 'string'
    ? withoutTrailingSlash(config.public.siteUrl)
    : undefined
  if (import.meta.server && siteUrl) {
    const url = withoutTrailingSlash(joinURL(siteUrl, appConfig.baseURL, to.fullPath))
    if (!head.meta.some(m => m.property === 'og:url')) {
      head.meta.push({
        property: 'og:url',
        content: url
      })
    }
    if (!head.link.some(m => m.rel === 'canonical')) {
      head.link.push({
        rel: 'canonical',
        href: url
      })
    }
  }

  const description = head?.description || data?.description

  if (description && head.meta.filter(m => m.name === 'description').length === 0) {
    head.meta.push({
      name: 'description',
      content: description
    })
  }
  if (import.meta.server && description && !head.meta.some(m => m.property === 'og:description')) {
    head.meta.push({
      property: 'og:description',
      content: description
    })
  }

  const image = head?.image || data?.image

  if (import.meta.server && image && head.meta.filter(m => m.property === 'og:image').length === 0) {
    if (typeof image === 'string') {
      head.meta.push({
        property: 'og:image',
        content: siteUrl && !hasProtocol(image) ? new URL(joinURL(appConfig.baseURL, image), siteUrl).href : image
      })
    }

    if (isHeadImageObject(image)) {
      const imageKeys = [
        'src',
        'secure_url',
        'type',
        'width',
        'height',
        'alt'
      ]

      for (const key of imageKeys) {
        // `src` is a shorthand for the URL.
        if (key === 'src' && image.src) {
          const isAbsoluteURL = hasProtocol(image.src)
          const imageURL = isAbsoluteURL ? image.src : joinURL(appConfig.baseURL, image.src ?? '/')
          head.meta.push({
            property: 'og:image',
            content: siteUrl && !isAbsoluteURL ? new URL(imageURL, siteUrl).href : imageURL
          })
        } else if (image[key]) {
          head.meta.push({
            property: `og:image:${key}`,
            content: image[key]
          })
        }
      }
    }
  }

  return head
}
