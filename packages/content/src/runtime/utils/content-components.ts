import type { AsyncComponentLoader } from 'vue'

type ContentComponentsModule = {
  globalComponents: string[]
  localComponents: string[]
  localComponentLoaders: Record<string, AsyncComponentLoader>
}

declare module '#build/content-components' {
  export const globalComponents: string[]
  export const localComponents: string[]
  export const localComponentLoaders: Record<string, AsyncComponentLoader>
}

const fallbackContentComponents: ContentComponentsModule = {
  globalComponents: [],
  localComponents: [],
  localComponentLoaders: {}
}

async function loadContentComponents(): Promise<ContentComponentsModule> {
  try {
    return await import('#build/content-components') as ContentComponentsModule
  } catch {
    return fallbackContentComponents
  }
}

const contentComponents = await loadContentComponents()

export const globalComponents = contentComponents.globalComponents
export const localComponents = contentComponents.localComponents
export const localComponentLoaders = contentComponents.localComponentLoaders
