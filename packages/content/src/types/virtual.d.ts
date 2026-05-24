declare module '#content/virtual/config' {
  import type { ContentConfig } from './config'

  const config: ContentConfig
  export default config
}

declare module '#content/virtual/providers' {
  import type { ContentProvider } from '../public/provider'

  export const externalContentProviderNames: string[]
  export const loadExternalContentProvider: (name: string) => Promise<ContentProvider | undefined> | ContentProvider | undefined
}

declare module '#content/virtual/cache-adapter' {
  import type { ContentCacheAdapter } from '../public/provider'

  export const loadContentCacheAdapter: () => Promise<ContentCacheAdapter | undefined> | ContentCacheAdapter | undefined
}
