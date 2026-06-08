import fs from 'fs'
import { join } from 'pathe'
import { addComponentsDir, addImports, addPlugin, addServerImports, addTypeTemplate } from '@nuxt/kit'
import type { addTemplate } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

export const runtimeAppImportSpecs = [
  { name: 'getCollectionPath', as: 'getCollectionPath', from: './query/routes.js' },
  { name: 'useContentHead', as: 'useContentHead', from: './app/composables/head.js' },
  { name: 'useContentPage', as: 'useContentPage', from: './app/composables/use-content.js' },
  { name: 'useContentOne', as: 'useContentOne', from: './app/composables/use-content.js' },
  { name: 'useContentMany', as: 'useContentMany', from: './app/composables/use-content.js' },
  { name: 'useContentPagination', as: 'useContentPagination', from: './app/composables/use-content.js' },
  { name: 'useContentBacklinks', as: 'useContentBacklinks', from: './app/composables/use-content.js' },
  { name: 'useContentResolveOne', as: 'useContentResolveOne', from: './app/composables/use-content.js' },
  { name: 'useContentVariants', as: 'useContentVariants', from: './app/composables/use-content.js' },
  { name: 'useContentTree', as: 'useContentTree', from: './app/composables/use-content.js' },
  { name: 'useContentNavigation', as: 'useContentNavigation', from: './app/composables/use-content.js' },
  { name: 'useContentNeighbors', as: 'useContentNeighbors', from: './app/composables/use-content.js' },
  { name: 'useContentSwitchLocalePath', as: 'useContentSwitchLocalePath', from: './app/composables/route.js' },
  { name: 'useContentSearchData', as: 'useContentSearchData', from: './app/composables/search.js' },
  { name: 'useContentSearchResults', as: 'useContentSearchResults', from: './app/composables/search.js' },
  { name: 'querySiteData', as: 'querySiteData', from: './app/composables/site-data.js' }
] as const

export const runtimeServerImportSpecs = [
  { name: 'one', as: 'one' },
  { name: 'many', as: 'many' },
  { name: 'paginate', as: 'paginate' },
  { name: 'backlinks', as: 'backlinks' },
  { name: 'resolveOne', as: 'resolveOne' },
  { name: 'variants', as: 'variants' },
  { name: 'tree', as: 'tree' },
  { name: 'neighbors', as: 'neighbors' },
  { name: 'getCollectionPath', as: 'getCollectionPath' },
  { name: 'queryCollectionsSitemapEntries', as: 'queryCollectionsSitemapEntries' }
] as const

export const generatedContentServerValueNames = [
  ...runtimeServerImportSpecs.map(spec => spec.name),
  'contentCacheHeaders',
  'noopContentCache',
  'vercelContentCache',
  'clearContentCacheHint',
  'collectContentCacheHint',
  'getContentCacheHint',
  'withContentCache',
  'createContentProviderError'
] as const

export const generatedContentServerTypeSpecs = [
  { local: 'ContentCacheAdapter', exported: 'ContentCacheAdapter' },
  { local: 'ContentCacheHint', exported: 'ContentCacheHint' },
  { local: 'ContentCacheHintInput', exported: 'ContentCacheHintInput' },
  { local: 'ContentCacheInvalidateInput', exported: 'ContentCacheInvalidateInput' },
  { local: 'ContentProvider', exported: 'ContentProvider' },
  { local: 'ContentProviderCapabilities', exported: 'ContentProviderCapabilities' },
  { local: 'ContentProviderResult<T>', exported: 'ContentProviderResult<T>' },
  { local: 'MaybeContentProviderResult<T>', exported: 'MaybeContentProviderResult<T>' },
  { local: 'ContentProviderErrorCode', exported: 'ContentProviderErrorCode' },
  { local: 'VercelContentCacheOptions', exported: 'VercelContentCacheOptions' }
] as const

export const registerRuntimeImports = (resolveRuntimeModule: (path: string) => string) => {
  addImports(runtimeAppImportSpecs.map(spec => ({
    ...spec,
    from: resolveRuntimeModule(spec.from)
  })))

  addServerImports(runtimeServerImportSpecs.map(spec => ({
    ...spec,
    from: resolveRuntimeModule('./server/index.js')
  })))
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

export const registerUserContentComponents = async (nuxt: Nuxt, _resolve: (path: string) => string) => {
  const layers = [...nuxt.options._layers]
  for (const layer of layers) {
    const srcDir = layer.config.srcDir
    const globalComponents = join(srcDir, 'components/content')
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
  resolveRuntimeModuleRoot: (path: string) => string,
  collectionNames: string[] = [],
  i18nCollectionNames: string[] = []
) => {
  const collectionNameUnion = collectionNames.length
    ? collectionNames.map(name => JSON.stringify(name)).join(' | ')
    : 'never'
  const i18nCollectionNameUnion = i18nCollectionNames.length
    ? i18nCollectionNames.map(name => JSON.stringify(name)).join(' | ')
    : 'never'
  const collectionMapProperties = collectionNames.map((name) => {
    const key = JSON.stringify(name)
    return `    ${key}: StrictParsedContent & __GeneratedCollectionSchema<__ContentCollectionExport<${key}>>`
  })
  const contentServerValueDeclarations = generatedContentServerValueNames.map(name =>
    `  const ${name}: typeof import('${resolveRuntimeModuleRoot('./server')}').${name}`
  )
  const contentServerTypeDeclarations = generatedContentServerTypeSpecs.map(spec =>
    `  type ${spec.local} = import('${resolveRuntimeModuleRoot('./server')}').${spec.exported}`
  )

  return addTypeTemplate({
    filename: 'types/content.d.ts',
    getContents: () => [
      contentConfigPath
        ? `import type contentConfig from ${JSON.stringify(contentConfigPath)}`
        : 'type __ContentConfig = { collections?: {} }',
      contentConfigPath
        ? `import type * as contentConfigModule from ${JSON.stringify(contentConfigPath)}`
        : 'declare const contentConfigModule: {}',
      'import type { StrictParsedContent } from \'@lupinum/ginko-content\'',
      'import type { CollectionSchema } from \'@lupinum/ginko-content/config\'',
      contentConfigPath
        ? 'type __ContentConfig = typeof contentConfig'
        : '',
      'type __ContentCollections = NonNullable<__ContentConfig[\'collections\']>',
      `type __RuntimeContentCollectionNames = ${collectionNameUnion}`,
      'type __NamedContentCollectionNames = {',
      '  [K in keyof typeof contentConfigModule & string]: typeof contentConfigModule[K] extends { name: K } ? K : never',
      '}[keyof typeof contentConfigModule & string]',
      'type __InferredContentCollectionNames = string extends keyof __ContentCollections',
      '  ? __NamedContentCollectionNames',
      '  : keyof __ContentCollections & string',
      'type __ContentCollectionNames = [__RuntimeContentCollectionNames] extends [never]',
      '  ? __InferredContentCollectionNames',
      '  : __RuntimeContentCollectionNames',
      'type __ContentCollectionExport<K extends string> = K extends keyof typeof contentConfigModule',
      '  ? typeof contentConfigModule[K]',
      '  : __ContentCollections[K]',
      'type __GeneratedCollectionSchema<TCollection> = TCollection extends { __schema: infer TSchema }',
      '  ? TSchema extends { _output: infer TOutput } ? TOutput : {}',
      '  : CollectionSchema<TCollection>',
      'type __GeneratedContentCollectionMap = {',
      '  [K in __ContentCollectionNames]: StrictParsedContent & __GeneratedCollectionSchema<__ContentCollectionExport<K>>',
      '}',
      `type __RuntimeI18nCollectionNames = ${i18nCollectionNameUnion}`,
      'type __InferredI18nCollectionNames = {',
      '  [K in __ContentCollectionNames]: __ContentCollectionExport<K> extends { __i18n: true }',
      '    ? K',
      '    : __ContentCollectionExport<K> extends { i18n: true } ? K : never',
      '}[__ContentCollectionNames]',
      'type __GeneratedI18nCollectionNames = [__RuntimeI18nCollectionNames] extends [never]',
      '  ? __InferredI18nCollectionNames',
      '  : __RuntimeI18nCollectionNames',
      'declare module \'@lupinum/ginko-content\' {',
      '  interface ContentCollectionMap extends __GeneratedContentCollectionMap {}',
      '  interface ContentCollectionI18nMap extends Pick<__GeneratedContentCollectionMap, __GeneratedI18nCollectionNames> {}',
      '}',
      'declare global {',
      '  interface GinkoContentCollectionMap {',
      ...collectionMapProperties,
      '  }',
      '  interface GinkoContentCollectionI18nMap extends Pick<__GeneratedContentCollectionMap, __GeneratedI18nCollectionNames> {}',
      '}',
      'declare module \'@lupinum/ginko-content/dist/types/query\' {',
      '  interface ContentCollectionMap extends __GeneratedContentCollectionMap {}',
      '  interface ContentCollectionI18nMap extends Pick<__GeneratedContentCollectionMap, __GeneratedI18nCollectionNames> {}',
      '}',
      'declare module \'@lupinum/ginko-content/dist/types/query.js\' {',
      '  interface ContentCollectionMap extends __GeneratedContentCollectionMap {}',
      '  interface ContentCollectionI18nMap extends Pick<__GeneratedContentCollectionMap, __GeneratedI18nCollectionNames> {}',
      '}',
      'declare module \'#content/server\' {',
      ...contentServerValueDeclarations,
      ...contentServerTypeDeclarations,
      '}'
    ].filter(Boolean).join('\n')
  })
}
export const registerDevRuntimePlugin = (resolveRuntimeModule: (path: string) => string) => {
  addPlugin(resolveRuntimeModule('./app/plugins/hot-reload.js'))
}
