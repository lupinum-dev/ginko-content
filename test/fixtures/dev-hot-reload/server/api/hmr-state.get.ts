import { defineEventHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export default defineEventHandler(async (event) => {
  const { one } = await import('#content/server')
  const watched = await one(event, 'pages' as any, {
    by: { path: '/watched' }
  })
  let secondaryTitle: string | null = null

  try {
    const secondary = await one(event, 'secondary' as any, {
      by: { path: '/config-only' }
    })
    secondaryTitle = secondary?.title || null
  } catch {
    // The collection is added during the restart portion of the test.
  }

  return {
    bootId: useRuntimeConfig(event).public.devBootId,
    watchedTitle: watched?.title || null,
    cacheMarker: (watched as { cacheMarker?: string } | null)?.cacheMarker || null,
    secondaryTitle
  }
})
