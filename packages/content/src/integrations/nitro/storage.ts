import { prefixStorage, type Storage } from 'unstorage'
import type { H3Event } from 'h3'
import { useStorage } from 'nitropack/runtime'
import authoredContentConfig from '#content/virtual/config'
import { makeIgnored } from '../../core/content/ignore'
import type { ContentCollectionConfig, ContentConfig } from '../../types/config'
import { getContentRuntimeContext } from './context'
import { getPreview, isPreview } from './preview'
import { getContentRuntimeConfig } from './runtime-config'

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

const liveCollections = ((authoredContentConfig as ContentConfig | undefined)?.collections || {}) as Record<string, ContentCollectionConfig>

export const contentConfig = () => {
  const runtimeContent = getContentRuntimeConfig().content
  const runtimeCollections = runtimeContent.collections as Record<string, Record<string, unknown>> | undefined
  if (!runtimeCollections) {
    return runtimeContent
  }

  let hasLiveSchemas = false
  const collections = Object.fromEntries(Object.entries(runtimeCollections).map(([name, collection]) => {
    const schema = liveCollections[name]?.schema
    if (!schema) {
      return [name, collection]
    }

    hasLiveSchemas = true
    return [name, { ...collection, schema }]
  }))

  return hasLiveSchemas
    ? { ...runtimeContent, collections }
    : runtimeContent
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
  const source = sourceStorage(event)
  let keys = await source.getKeys(prefix)

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

export const getSourceContentIds = async (event: H3Event, prefix?: string) => {
  const keys = await sourceStorage(event).getKeys(prefix)
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
