import { defineEventHandler } from 'h3'
import type { NavItem } from '../../../types/content'
import { getContentProvider } from '../providers'
import { createContentProviderError } from '../../../public/provider-errors'
import { cacheStorage } from '../storage-access'

export default defineEventHandler(async (event) => {
  const now = Date.now()
  const contents: unknown[] = []

  const provider = await getContentProvider(event)
  if (!provider.navigationQuery) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support navigation queries`, {
      provider: provider.name
    })
  }
  const navigation: NavItem[] = await provider.navigationQuery(event, {})
  await cacheStorage(event).setItem('_nav.json', navigation)

  const meta = {
    generatedAt: now,
    generateTime: Date.now() - now
  }
  await cacheStorage(event).setItem('_meta.json', meta)

  return {
    ...meta,
    contents,
    navigation
  }
})
