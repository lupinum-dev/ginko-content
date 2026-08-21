import { createError, useSeoMeta, useRoute } from '#imports'
import type { ContentCollectionTarget, DocumentFromHandle, PopulateSpec, PopulatedDocument } from '../../../types/query'
import { useContentPage } from './use-content-page'
import type { UseContentPageOptions, UseContentPageReturn } from './use-content-page'

export interface DefineContentPageSeoOptions {
  title?: string | (() => string | undefined)
  description?: string | (() => string | undefined)
}

interface DefineContentPagePolicy {
  /**
   * Policy when no document matches the current route.
   *
   * - `'throw'` (default) throws a fatal 404 once the query settles empty —
   *   the same behavior as the manual `if (!page.value) throw createError(...)`
   *   pattern.
   * - `'render'` leaves `page` undefined so the component can render its own
   *   not-found state.
   * - `false` disables the check entirely.
   */
  notFound?: 'throw' | 'render' | false
  /**
   * Sync the document's `title` and `description` to head tags via
   * `useSeoMeta`. Pass `false` to manage head tags yourself. Custom static or
   * getter overrides win over the document values.
   */
  seo?: boolean | DefineContentPageSeoOptions
}

export type DefineContentPageOptions<
  H = unknown,
  P extends PopulateSpec | undefined = undefined
> = UseContentPageOptions<H, P> & DefineContentPagePolicy

/**
 * The opinionated page workflow for route-backed collections. It wraps
 * `useContentPage` and owns the two policies every content page needs:
 * what happens when nothing matches (404), and whether document metadata
 * becomes head tags.
 *
 * Call it inside `<script setup>` of a catch-all page. Pair it with
 * `definePageMeta({ key: route => route.path })` so each path gets its own
 * component instance and payload entry.
 */
export async function defineContentPage<
  const H extends ContentCollectionTarget,
  P extends PopulateSpec | undefined = undefined
>(
  handle: H,
  options: DefineContentPageOptions<H, P> = {} as DefineContentPageOptions<H, P>
): Promise<UseContentPageReturn<PopulatedDocument<DocumentFromHandle<H>, P>>> {
  const route = useRoute()
  const { notFound = 'throw', seo = true, ...pageOptions } = options as DefineContentPageOptions<H, P> & Record<string, unknown>

  const result = await useContentPage<H, P>(handle, pageOptions as UseContentPageOptions<H, P>)
  const { page, status } = result

  if (notFound === 'throw' && status.value === 'success' && !page.value) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Page not found',
      fatal: true,
      data: {
        collection: typeof handle === 'string' ? handle : (handle as { name?: string }).name,
        path: route.path
      }
    })
  }

  if (seo) {
    const overrides = seo === true ? {} : seo
    const resolveOverride = (value: string | (() => string | undefined) | undefined) =>
      typeof value === 'function' ? value() : value

    useSeoMeta({
      title: () => resolveOverride(overrides.title) ?? (page.value?.title as string | undefined),
      description: () => resolveOverride(overrides.description) ?? (page.value?.description as string | undefined),
      ogTitle: () => page.value?.title as string | undefined,
      ogDescription: () => page.value?.description as string | undefined
    })
  }

  return result
}
