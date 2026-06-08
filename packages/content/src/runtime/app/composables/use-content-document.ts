import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useAsyncData } from '#imports'
import type {
  ContentCollectionTarget,
  DocumentFromHandle,
  LocalizedDoc,
  OneOptions,
  PopulateFromOptions,
  PopulateSpec,
  PopulatedDocument,
  ResolveOneOptions,
  ResolveOneResult
} from '../../../types/query'
import { createClientContentQueryContext } from './query-api'
import {
  one as oneWithContext,
  resolveOne as resolveOneWithContext
} from '../../query/unified'
import { contentCollectionName, resolveOptions, stableKey, type Reactive } from './use-content-shared'

type DocFromHandle<H> = DocumentFromHandle<H>

interface UseContentOneReturn<T> {
  data: ComputedRef<LocalizedDoc<T> | null>
  pending: ComputedRef<boolean>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve a single document. Reruns when any reactive source on
 * `options` changes. Caching follows Nuxt's standard `useAsyncData` semantics
 * keyed by `${collection}:${stableHash(options)}`.
 */
export async function useContentOne<
  const H extends ContentCollectionTarget,
  O extends OneOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O>
): Promise<UseContentOneReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as O)
  const key = computed(() => stableKey('content-one', contentCollectionName(handle), resolved.value))
  const context = createClientContentQueryContext()
  const asyncDataPromise = useAsyncData<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>> | null>(
    key,
    () => oneWithContext(context, handle, resolved.value) as Promise<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>> | null>,
    { watch: [resolved], default: () => null }
  )
  const asyncData = await asyncDataPromise

  return {
    data: computed(() => asyncData.data.value as LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>> | null),
    pending: computed(() => asyncData.pending.value),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

interface UseContentResolveOneReturn<T> {
  doc: ComputedRef<LocalizedDoc<T> | null>
  explain: ComputedRef<ResolveOneResult<T>['explain'] | null>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

/**
 * Reactively resolve a single document with a first-class diagnostic envelope.
 */
export async function useContentResolveOne<
  const H extends ContentCollectionTarget,
  O extends ResolveOneOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O>
): Promise<UseContentResolveOneReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as O)
  const key = computed(() => stableKey('content-resolve-one', contentCollectionName(handle), resolved.value))
  const context = createClientContentQueryContext()
  const asyncDataPromise = useAsyncData<ResolveOneResult<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>(
    key,
    () => resolveOneWithContext(context, handle, resolved.value) as Promise<ResolveOneResult<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>,
    { watch: [resolved] }
  )
  const asyncData = await asyncDataPromise

  return {
    doc: computed(() => asyncData.data.value?.doc ?? null),
    explain: computed(() => asyncData.data.value?.explain ?? null),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}
