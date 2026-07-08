import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useAsyncData } from '#imports'
import type {
  BacklinksOptions,
  BacklinksResult,
  BacklinkSource,
  ContentCollectionTarget,
  ContentVariant,
  DocumentFromHandle,
  ManyOptions,
  LocalizedDoc,
  PaginationOptions,
  PaginationResult,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  VariantsOptions
} from '../../../types/query'
import { createClientContentQueryContext } from './query-api'
import {
  backlinks as backlinksWithContext,
  many as manyWithContext,
  paginate as paginateWithContext,
  variants as variantsWithContext
} from '../../../features/query/unified'
import { contentCollectionName, resolveOptions, stableKey, type Reactive, type ReactiveValue } from './use-content-shared'

type DocFromHandle<H> = DocumentFromHandle<H>

interface UseContentManyReturn<T> {
  data: ComputedRef<Array<LocalizedDoc<T>>>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

interface UseContentPaginationReturn<T> {
  data: ComputedRef<Array<LocalizedDoc<T>>>
  page: ComputedRef<number>
  limit: ComputedRef<number>
  total: ComputedRef<number>
  pageCount: ComputedRef<number>
  hasNext: ComputedRef<boolean>
  hasPrev: ComputedRef<boolean>
  nextPage: ComputedRef<number | null>
  prevPage: ComputedRef<number | null>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

export async function useContentMany<
  const H extends ContentCollectionTarget,
  O extends ManyOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O> = {} as Reactive<O>
): Promise<UseContentManyReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as O)
  const key = computed(() => stableKey('content-many', contentCollectionName(handle), resolved.value))
  const context = createClientContentQueryContext()
  const asyncDataPromise = useAsyncData<Array<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>>(
    key,
    () => manyWithContext(context, handle, resolved.value) as Promise<Array<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>>,
    { watch: [resolved], default: () => [] }
  )
  const asyncData = await asyncDataPromise

  return {
    data: computed(() => (asyncData.data.value || []) as Array<LocalizedDoc<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>>),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

const emptyPagination = <T>(): PaginationResult<T> => ({
  data: [],
  page: 1,
  limit: 10,
  total: 0,
  pageCount: 0,
  hasNext: false,
  hasPrev: false,
  nextPage: null,
  prevPage: null
})

export async function useContentPagination<
  const H extends ContentCollectionTarget,
  O extends PaginationOptions<H, PopulateSpec | undefined>
> (
  handle: H,
  options: Reactive<O>
): Promise<UseContentPaginationReturn<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as O)
  const key = computed(() => stableKey('content-pagination', contentCollectionName(handle), resolved.value))
  const context = createClientContentQueryContext()
  type PageResult = PaginationResult<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>
  const asyncDataPromise = useAsyncData<PageResult>(
    key,
    () => paginateWithContext(context, handle, resolved.value) as Promise<PageResult>,
    { watch: [resolved], default: () => emptyPagination<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>() }
  )
  const asyncData = await asyncDataPromise
  const result = computed(() => asyncData.data.value || emptyPagination<PopulatedDocument<DocFromHandle<H>, PopulateFromOptions<O>>>())

  return {
    data: computed(() => result.value.data),
    page: computed(() => result.value.page),
    limit: computed(() => result.value.limit),
    total: computed(() => result.value.total),
    pageCount: computed(() => result.value.pageCount),
    hasNext: computed(() => result.value.hasNext),
    hasPrev: computed(() => result.value.hasPrev),
    nextPage: computed(() => result.value.nextPage),
    prevPage: computed(() => result.value.prevPage),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

interface UseContentBacklinksReturn<T> {
  data: ComputedRef<T[]>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

export async function useContentBacklinks<
  const Target extends ContentCollectionTarget,
  const Source extends BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
> (
  handle: Target,
  options: Reactive<BacklinksOptions<Target, Source, P>> & { from: ReactiveValue<Source> }
): Promise<UseContentBacklinksReturn<BacklinksResult<Source, P>[number]>> {
  const resolved = computed(() => resolveOptions(options as unknown as Reactive<Record<string, unknown>>) as unknown as BacklinksOptions<Target, Source, P>)
  const key = computed(() => stableKey('content-backlinks', contentCollectionName(handle), resolved.value))
  const context = createClientContentQueryContext()
  type BacklinksData = BacklinksResult<Source, P>
  const asyncDataPromise = useAsyncData<BacklinksData>(
    key,
    () => backlinksWithContext(context, handle, resolved.value) as Promise<BacklinksData>,
    { watch: [resolved], default: () => [] as unknown as BacklinksData }
  )
  const asyncData = await asyncDataPromise

  return {
    data: computed(() => (asyncData.data.value || []) as BacklinksData),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

interface UseContentVariantsReturn<T> {
  data: ComputedRef<Array<ContentVariant<T>>>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

export async function useContentVariants<H extends ContentCollectionTarget> (
  handle: H,
  options: Reactive<VariantsOptions<H>>
): Promise<UseContentVariantsReturn<DocFromHandle<H>>> {
  const resolved = computed(() => resolveOptions(options as unknown as Reactive<Record<string, unknown>>) as unknown as VariantsOptions<H>)
  const key = computed(() => stableKey('content-variants', contentCollectionName(handle), resolved.value))
  const context = createClientContentQueryContext()
  const asyncDataPromise = useAsyncData<Array<ContentVariant<DocFromHandle<H>>>>(
    key,
    () => variantsWithContext(context, handle, resolved.value as VariantsOptions<H>) as Promise<Array<ContentVariant<DocFromHandle<H>>>>,
    { watch: [resolved], default: () => [] }
  )
  const asyncData = await asyncDataPromise

  return {
    data: computed(() => (asyncData.data.value || []) as Array<ContentVariant<DocFromHandle<H>>>),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}
