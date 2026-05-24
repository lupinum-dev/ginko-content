import fs from 'fs'
import { addComponentsDir, addImports, addPlugin, addServerImports, addTypeTemplate } from '@nuxt/kit'
import type { addTemplate } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

export const registerRuntimeImports = (resolveRuntimeModule: (path: string) => string) => {
  addImports([
    // Unified query API (ADR-0016) — app wrappers bind the Nuxt content context explicitly.
    { name: 'one', as: 'one', from: resolveRuntimeModule('./app/composables/query-api.js') },
    { name: 'many', as: 'many', from: resolveRuntimeModule('./app/composables/query-api.js') },
    { name: 'paginate', as: 'paginate', from: resolveRuntimeModule('./app/composables/query-api.js') },
    { name: 'backlinks', as: 'backlinks', from: resolveRuntimeModule('./app/composables/query-api.js') },
    { name: 'resolveOne', as: 'resolveOne', from: resolveRuntimeModule('./app/composables/query-api.js') },
    { name: 'variants', as: 'variants', from: resolveRuntimeModule('./app/composables/query-api.js') },
    { name: 'tree', as: 'tree', from: resolveRuntimeModule('./app/composables/query-api.js') },
    { name: 'neighbors', as: 'neighbors', from: resolveRuntimeModule('./app/composables/query-api.js') },
    { name: 'getCollectionPath', as: 'getCollectionPath', from: resolveRuntimeModule('./query/routes.js') },
    // Vue composables — reactive wrappers over the same options shape.
    { name: 'useContentPage', as: 'useContentPage', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentOne', as: 'useContentOne', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentMany', as: 'useContentMany', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentPagination', as: 'useContentPagination', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentBacklinks', as: 'useContentBacklinks', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentResolveOne', as: 'useContentResolveOne', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentVariants', as: 'useContentVariants', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentTree', as: 'useContentTree', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentNeighbors', as: 'useContentNeighbors', from: resolveRuntimeModule('./app/composables/use-content.js') },
    { name: 'useContentLocaleSwitch', as: 'useContentLocaleSwitch', from: resolveRuntimeModule('./app/composables/use-content.js') },
    // Search & site data — kept (out of scope for ADR-0016).
    { name: 'useContentSearchData', as: 'useContentSearchData', from: resolveRuntimeModule('./app/composables/search.js') },
    { name: 'useContentSearchResults', as: 'useContentSearchResults', from: resolveRuntimeModule('./app/composables/search.js') },
    { name: 'querySiteData', as: 'querySiteData', from: resolveRuntimeModule('./app/composables/site-data.js') }
  ])

  addServerImports([
    { name: 'one', as: 'one', from: resolveRuntimeModule('./server/index.js') },
    { name: 'many', as: 'many', from: resolveRuntimeModule('./server/index.js') },
    { name: 'paginate', as: 'paginate', from: resolveRuntimeModule('./server/index.js') },
    { name: 'backlinks', as: 'backlinks', from: resolveRuntimeModule('./server/index.js') },
    { name: 'resolveOne', as: 'resolveOne', from: resolveRuntimeModule('./server/index.js') },
    { name: 'variants', as: 'variants', from: resolveRuntimeModule('./server/index.js') },
    { name: 'tree', as: 'tree', from: resolveRuntimeModule('./server/index.js') },
    { name: 'neighbors', as: 'neighbors', from: resolveRuntimeModule('./server/index.js') },
    { name: 'getCollectionPath', as: 'getCollectionPath', from: resolveRuntimeModule('./server/index.js') },
    { name: 'queryCollectionsSitemapEntries', as: 'queryCollectionsSitemapEntries', from: resolveRuntimeModule('./server/index.js') }
  ])
}

export const registerRuntimeComponents = (resolve: (path: string) => string) => {
  addComponentsDir({
    path: resolve('./runtime/app/components'),
    pathPrefix: false,
    prefix: '',
    global: true,
    ignore: ['Prose/**', 'internal/**']
  })
}

export const registerContentI18nTemplate = (
  addTemplateImpl: typeof addTemplate,
  hasNuxtI18nModule: boolean
) => {
  addTemplateImpl({
    filename: 'content-i18n.mjs',
    write: true,
    getContents: () => hasNuxtI18nModule
      ? [
          'export { useRouteBaseName, useSetI18nParams, useSwitchLocalePath } from \'#i18n\''
        ].join('\n')
      : [
          'const routeNameLocaleRE = /___([^_]+)$/',
          'const resolveName = (value) => {',
          '  if (typeof value === \'string\') {',
          '    return value',
          '  }',
          '  if (value && typeof value === \'object\' && \'name\' in value) {',
          '    return value.name',
          '  }',
          '  return undefined',
          '}',
          'export const useRouteBaseName = () => (value) => {',
          '  const name = resolveName(value)',
          '  return typeof name === \'string\' ? name.replace(routeNameLocaleRE, \'\') : undefined',
          '}',
          'export const useSetI18nParams = () => () => {}',
          'export const useSwitchLocalePath = () => () => \'\''
        ].join('\n')
  })
  addTemplateImpl({
    filename: 'content-i18n.d.mts',
    write: true,
    getContents: () => [
      'export function useRouteBaseName(): (route: { name?: unknown } | unknown) => string | undefined',
      'export function useSetI18nParams(): (params: Record<string, unknown>) => void',
      'export function useSwitchLocalePath(): (locale: string) => string'
    ].join('\n')
  })

  addTypeTemplate({
    filename: 'types/content-i18n.d.ts',
    getContents: () => [
      'declare module \'#build/content-i18n.mjs\' {',
      '  export function useRouteBaseName(): (route: { name?: unknown } | unknown) => string | undefined',
      '  export function useSetI18nParams(): (params: Record<string, unknown>) => void',
      '  export function useSwitchLocalePath(): (locale: string) => string',
      '}'
    ].join('\n')
  })
}

export const registerUserContentComponents = async (nuxt: Nuxt, resolve: (path: string) => string) => {
  const layers = [...nuxt.options._layers]
  for (const layer of layers) {
    const srcDir = layer.config.srcDir
    const globalComponents = resolve(srcDir, 'components/content')
    const dirStat = await fs.promises.stat(globalComponents).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null
      }

      throw error
    })
    if (dirStat && dirStat.isDirectory()) {
      nuxt.hook('components:dirs', (dirs) => {
        dirs.unshift({
          path: globalComponents,
          global: false,
          pathPrefix: false,
          prefix: ''
        })
      })
    }
  }
}

export const registerGeneratedTypes = (
  contentConfigPath: string | undefined,
  resolveRuntimeModuleRoot: (path: string) => string
) => {
  return addTypeTemplate({
    filename: 'types/content.d.ts',
    getContents: () => [
      contentConfigPath
        ? `import type contentConfig from ${JSON.stringify(contentConfigPath)}`
        : 'type __ContentConfig = { collections?: {} }',
      'import type { StrictParsedContent } from \'@lupinum/ginko-content\'',
      'import type { CollectionSchema } from \'@lupinum/ginko-content/config\'',
      contentConfigPath
        ? 'type __ContentConfig = typeof contentConfig'
        : '',
      'type __ContentCollections = NonNullable<__ContentConfig[\'collections\']>',
      'type __GeneratedContentCollectionMap = {',
      '  [K in keyof __ContentCollections & string]: StrictParsedContent & CollectionSchema<__ContentCollections[K]>',
      '}',
      'type __GeneratedI18nCollectionNames = {',
      '  [K in keyof __ContentCollections & string]: NonNullable<__ContentCollections[K][\'i18n\']> extends never ? never : K',
      '}[keyof __ContentCollections & string]',
      'declare module \'@lupinum/ginko-content\' {',
      '  interface ContentCollectionMap extends __GeneratedContentCollectionMap {}',
      '  interface ContentCollectionI18nMap extends Pick<__GeneratedContentCollectionMap, __GeneratedI18nCollectionNames> {}',
      '}',
      'declare module \'#content/server\' {',
      `  const one: typeof import('${resolveRuntimeModuleRoot('./server')}').one`,
      `  const many: typeof import('${resolveRuntimeModuleRoot('./server')}').many`,
      `  const paginate: typeof import('${resolveRuntimeModuleRoot('./server')}').paginate`,
      `  const backlinks: typeof import('${resolveRuntimeModuleRoot('./server')}').backlinks`,
      `  const resolveOne: typeof import('${resolveRuntimeModuleRoot('./server')}').resolveOne`,
      `  const variants: typeof import('${resolveRuntimeModuleRoot('./server')}').variants`,
      `  const tree: typeof import('${resolveRuntimeModuleRoot('./server')}').tree`,
      `  const neighbors: typeof import('${resolveRuntimeModuleRoot('./server')}').neighbors`,
      `  const queryCollectionsSitemapEntries: typeof import('${resolveRuntimeModuleRoot('./server')}').queryCollectionsSitemapEntries`,
      `  const contentCacheHeaders: typeof import('${resolveRuntimeModuleRoot('./server')}').contentCacheHeaders`,
      `  const noopContentCache: typeof import('${resolveRuntimeModuleRoot('./server')}').noopContentCache`,
      `  const vercelContentCache: typeof import('${resolveRuntimeModuleRoot('./server')}').vercelContentCache`,
      `  const clearContentCacheHint: typeof import('${resolveRuntimeModuleRoot('./server')}').clearContentCacheHint`,
      `  const collectContentCacheHint: typeof import('${resolveRuntimeModuleRoot('./server')}').collectContentCacheHint`,
      `  const getContentCacheHint: typeof import('${resolveRuntimeModuleRoot('./server')}').getContentCacheHint`,
      `  const withContentCache: typeof import('${resolveRuntimeModuleRoot('./server')}').withContentCache`,
      `  const createContentProviderError: typeof import('${resolveRuntimeModuleRoot('./server')}').createContentProviderError`,
      `  type ContentCacheAdapter = import('${resolveRuntimeModuleRoot('./server')}').ContentCacheAdapter`,
      `  type ContentCacheHint = import('${resolveRuntimeModuleRoot('./server')}').ContentCacheHint`,
      `  type ContentCacheHintInput = import('${resolveRuntimeModuleRoot('./server')}').ContentCacheHintInput`,
      `  type ContentCacheInvalidateInput = import('${resolveRuntimeModuleRoot('./server')}').ContentCacheInvalidateInput`,
      `  type ContentProvider = import('${resolveRuntimeModuleRoot('./server')}').ContentProvider`,
      `  type ContentProviderCapabilities = import('${resolveRuntimeModuleRoot('./server')}').ContentProviderCapabilities`,
      `  type ContentProviderResult<T> = import('${resolveRuntimeModuleRoot('./server')}').ContentProviderResult<T>`,
      `  type MaybeContentProviderResult<T> = import('${resolveRuntimeModuleRoot('./server')}').MaybeContentProviderResult<T>`,
      `  type ContentProviderErrorCode = import('${resolveRuntimeModuleRoot('./server')}').ContentProviderErrorCode`,
      `  type VercelContentCacheOptions = import('${resolveRuntimeModuleRoot('./server')}').VercelContentCacheOptions`,
      '}'
    ].filter(Boolean).join('\n')
  })
}
export const registerDevRuntimePlugin = (resolveRuntimeModule: (path: string) => string) => {
  addPlugin(resolveRuntimeModule('./app/plugins/ws.js'))
}
