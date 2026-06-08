import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useAsyncData } from '#imports'
import type {
  ContentCollectionTarget,
  ContentTreeItem,
  DocumentFromHandle,
  NeighborsOptions,
  NeighborsResult,
  TreeOptions
} from '../../../types/query'
import { createClientContentQueryContext } from './query-api'
import { neighbors as neighborsWithContext, tree as treeWithContext } from '../../query/unified'
import { contentCollectionName, resolveOptions, stableKey, type Reactive } from './use-content-shared'

export type ContentNavigationNode<T> = Omit<ContentTreeItem<T>, 'children'> & {
  id: string
  path: string
  title: string
  children: Array<ContentNavigationNode<T>>
}

const navigationNodeId = (item: ContentTreeItem<unknown> & Record<string, unknown>) => {
  const id = item.id ?? item._id ?? item._canonicalKey ?? item.path ?? item._path ?? item.title
  return typeof id === 'string' && id.length ? id : item.title
}

export const normalizeContentNavigation = <T>(items: Array<ContentTreeItem<T>> = []): Array<ContentNavigationNode<T>> => {
  return items.map((item) => {
    const source = item as ContentTreeItem<T> & Record<string, unknown>
    return {
      ...item,
      id: navigationNodeId(source),
      path: item.path,
      title: item.title,
      children: normalizeContentNavigation(item.children || [])
    }
  })
}

export const findFirstContentNavigationPage = <T>(items: Array<ContentNavigationNode<T>>): ContentNavigationNode<T> | null => {
  for (const item of items) {
    if (item.path) return item
    const child = findFirstContentNavigationPage(item.children)
    if (child) return child
  }
  return null
}

export const collectContentNavigationPaths = <T>(items: Array<ContentNavigationNode<T>>, paths = new Set<string>()) => {
  for (const item of items) {
    if (item.path) paths.add(item.path)
    collectContentNavigationPaths(item.children, paths)
  }
  return paths
}

type DocFromHandle<H> = DocumentFromHandle<H>

interface UseContentTreeReturn<T> {
  data: ComputedRef<T[]>
  pending: ComputedRef<boolean>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

interface UseContentNavigationReturn<T> {
  data: ComputedRef<Array<ContentNavigationNode<T>>>
  firstPage: ComputedRef<ContentNavigationNode<T> | null>
  paths: ComputedRef<Set<string>>
  pending: ComputedRef<boolean>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

export async function useContentTree<H extends ContentCollectionTarget> (
  handle: H,
  options: Reactive<TreeOptions<H>> = {} as Reactive<TreeOptions<H>>
): Promise<UseContentTreeReturn<ContentTreeItem<DocFromHandle<H>>>> {
  const resolved = computed(() => resolveOptions(options as Reactive<Record<string, unknown>>) as TreeOptions<H>)
  const key = computed(() => stableKey('content-tree', contentCollectionName(handle), resolved.value))
  const context = createClientContentQueryContext()
  type TreeResult = Array<ContentTreeItem<DocFromHandle<H>>>
  const asyncDataPromise = useAsyncData<TreeResult>(
    key,
    () => treeWithContext(context, handle, resolved.value as TreeOptions<H>) as Promise<TreeResult>,
    { watch: [resolved] }
  )
  const asyncData = await asyncDataPromise

  return {
    data: computed(() => (asyncData.data.value || []) as TreeResult),
    pending: computed(() => asyncData.pending.value),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}

export async function useContentNavigation<H extends ContentCollectionTarget> (
  handle: H,
  options: Reactive<TreeOptions<H>> = {} as Reactive<TreeOptions<H>>
): Promise<UseContentNavigationReturn<DocFromHandle<H>>> {
  const tree = await useContentTree(handle, options)
  const data = computed(() => normalizeContentNavigation(tree.data.value))

  return {
    data,
    firstPage: computed(() => findFirstContentNavigationPage(data.value)),
    paths: computed(() => collectContentNavigationPaths(data.value)),
    pending: tree.pending,
    status: tree.status,
    error: tree.error,
    refresh: tree.refresh
  }
}

interface UseContentNeighborsReturn<T> {
  data: ComputedRef<NeighborsResult<T>>
  pending: ComputedRef<boolean>
  status: ComputedRef<string>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
}

export async function useContentNeighbors<H extends ContentCollectionTarget> (
  handle: H,
  options: Reactive<NeighborsOptions<H>>
): Promise<UseContentNeighborsReturn<DocFromHandle<H>>> {
  const resolved = computed(() => resolveOptions(options as unknown as Reactive<Record<string, unknown>>) as unknown as NeighborsOptions<H>)
  const key = computed(() => stableKey('content-neighbors', contentCollectionName(handle), resolved.value))
  const context = createClientContentQueryContext()
  const asyncDataPromise = useAsyncData<NeighborsResult<DocFromHandle<H>>>(
    key,
    () => neighborsWithContext(context, handle, resolved.value as NeighborsOptions<H>) as Promise<NeighborsResult<DocFromHandle<H>>>,
    { watch: [resolved], default: () => ({ prev: null, next: null }) as NeighborsResult<DocFromHandle<H>> }
  )
  const asyncData = await asyncDataPromise

  return {
    data: computed(() => (asyncData.data.value || { prev: null, next: null }) as NeighborsResult<DocFromHandle<H>>),
    pending: computed(() => asyncData.pending.value),
    status: computed(() => asyncData.status.value),
    error: computed(() => asyncData.error.value),
    refresh: () => asyncData.refresh()
  }
}
