import { prefixStorage, type Storage } from 'unstorage'
import type { H3Event } from 'h3'
import { useStorage } from 'nitropack/runtime'
import virtualContentConfig from '#content/virtual/config'
import { makeIgnored } from '../../core/content/ignore'
import { getContentRuntimeContext } from './context'
import { getPreview, isPreview } from './preview'
import { getContentRuntimeConfig } from './runtime-config'
import type { ContentConfig } from '../../types/config'

const invalidKeyCharacters = ['\'', '"', '?', '#', '/']
const createScopedStorage = (prefix: string): Storage => prefixStorage(useStorage(), prefix)

const getEventStorages = (event: H3Event) => {
  const runtime = getContentRuntimeContext(event)
  runtime.storages ||= {
    sourceStorage: createScopedStorage('content:source'),
    cacheStorage: createScopedStorage('cache:content'),
    cacheParsedStorage: createScopedStorage('cache:content:parsed')
  }
  return runtime.storages
}

export const sourceStorage = (event?: H3Event) => {
  if (event) {
    return getEventStorages(event).sourceStorage
  }

  return createScopedStorage('content:source')
}

export const cacheStorage = (event?: H3Event) => {
  if (event) {
    return getEventStorages(event).cacheStorage
  }

  return createScopedStorage('cache:content')
}

export const cacheParsedStorage = (event?: H3Event) => {
  if (event) {
    return getEventStorages(event).cacheParsedStorage
  }

  return createScopedStorage('cache:content:parsed')
}

const mergeCollectionConfigs = (
  runtimeCollections: ContentConfig['collections'] = {},
  sourceCollections: ContentConfig['collections'] = {}
) => {
  const names = new Set([
    ...Object.keys(sourceCollections),
    ...Object.keys(runtimeCollections)
  ])

  return Object.fromEntries(Array.from(names).map((name) => {
    const source = sourceCollections[name] || {}
    const runtime = runtimeCollections[name] || {}
    return [
      name,
      {
        ...source,
        ...runtime,
        ...(source.schema ? { schema: source.schema } : {}),
        ...(source.providers ? { providers: source.providers } : {})
      }
    ]
  }))
}

export const contentConfig = () => {
  const runtimeContent = getContentRuntimeConfig().content
  const sourceContent = virtualContentConfig || {}

  return {
    ...runtimeContent,
    collections: mergeCollectionConfigs(runtimeContent.collections, sourceContent.collections)
  }
}

export const contentIgnorePredicate = (key: string) => {
  const isIgnored = makeIgnored(contentConfig().ignores)
  if (key.startsWith('preview:') || isIgnored(key)) {
    return false
  }

  if (invalidKeyCharacters.some(character => key.includes(character))) {
    console.warn(`Ignoring [${key}]. File name should not contain any of the following characters: ${invalidKeyCharacters.join(', ')}`)
    return false
  }

  return true
}

export const getContentsIds = async (event: H3Event, prefix?: string) => {
  let keys: string[] = []

  if (process.env.NODE_ENV === 'production') {
    keys = await cacheParsedStorage(event).getKeys(prefix)
  }

  const source = sourceStorage(event)
  if (keys.length === 0) {
    keys = await source.getKeys(prefix)
  }

  if (isPreview(event)) {
    const { key } = getPreview(event)
    const previewNamespace = `preview:${key}:`
    const previewPrefix = `${previewNamespace}${prefix || ''}`
    const previewKeys = await source.getKeys(previewPrefix)

    if (previewKeys.length) {
      const keysSet = new Set(keys)
      await Promise.all(previewKeys.map(async (previewKey) => {
        const normalizedPreviewKey = previewKey.startsWith(previewNamespace)
          ? previewKey.substring(previewNamespace.length)
          : previewKey
        const meta = await source.getMeta(previewKey)
        if (meta?.__deleted) {
          keysSet.delete(normalizedPreviewKey)
        } else {
          keysSet.add(normalizedPreviewKey)
        }
      }))
      keys = Array.from(keysSet)
    }
  }

  return keys.filter(contentIgnorePredicate)
}

export const resolveStorageId = async (event: H3Event, id: string) => {
  if (!isPreview(event)) {
    return id
  }

  const { key } = getPreview(event)
  const previewId = `preview:${key}:${id}`
  const draft = await sourceStorage(event).getItem(previewId)
  return draft ? previewId : id
}
