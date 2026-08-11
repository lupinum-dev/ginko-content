import fs from 'fs'
import { join } from 'pathe'
import { addComponentsDir, addImports, addPlugin, addServerImports, addTypeTemplate, getLayerDirectories } from '@nuxt/kit'
import type { addTemplate } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'

/**
 * The final app function auto-import list: exactly
 * `useContentPage` and the collision-safe `useGinkoContentSearch` alias.
 * The package export remains `useContentSearch`; one-shot query functions are
 * imported explicitly from `/client` instead.
 */
export const runtimeAppImportSpecs = [
  { name: 'useContentPage', as: 'useContentPage', from: './app/composables/use-content-page.js' },
  { name: 'useContentSearch', as: 'useGinkoContentSearch', from: './app/composables/search.js' }
] as const

export const runtimeServerImportSpecs = [
  { name: 'one', as: 'one' },
  { name: 'many', as: 'many' },
  { name: 'paginate', as: 'paginate' },
  { name: 'resolveOne', as: 'resolveOne' },
  { name: 'surround', as: 'surround' },
  { name: 'backlinks', as: 'backlinks' },
  { name: 'navigation', as: 'navigation' },
  { name: 'getCollectionPath', as: 'getCollectionPath' },
  { name: 'queryCollectionsSitemapEntries', as: 'queryCollectionsSitemapEntries' }
] as const

export const generatedContentServerValueNames = [
  ...runtimeServerImportSpecs.map(spec => spec.name)
] as const

export const generatedContentServerTypeSpecs = [] as const

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
          'export { useLocalePath } from \'#i18n\''
        ].join('\n')
      : [
          'import { useRouter } from \'#imports\'',
          'const resolveName = (value) => {',
          '  if (typeof value === \'string\') {',
          '    return value',
          '  }',
          '  if (value && typeof value === \'object\' && \'name\' in value) {',
          '    return value.name',
          '  }',
          '  return undefined',
          '}',
          'const normalizeRoutePath = (value) => value.startsWith(\'/\') ? value : `/${value}`',
          'const definedRecord = value => value && typeof value === \'object\'',
          '  ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))',
          '  : undefined',
          'export const useLocalePath = () => {',
          '  const router = useRouter()',
          '  return (value) => {',
          '    if (typeof value === \'string\') return normalizeRoutePath(value)',
          '    const name = resolveName(value)',
          '    if (!name) return \'\'',
          '    return router.resolve({',
          '      name,',
          '      ...(definedRecord(value.params) ? { params: definedRecord(value.params) } : {}),',
          '      ...(definedRecord(value.query) ? { query: definedRecord(value.query) } : {}),',
          '      ...(typeof value.hash === \'string\' ? { hash: value.hash } : {})',
          '    }).href',
          '  }',
          '}'
        ].join('\n')
  })
  addTemplateImpl({
    filename: 'content-i18n.d.mts',
    write: true,
    getContents: () => [
      'export function useLocalePath(): (route: string | { name?: string, hash?: string, params?: Record<string, unknown>, query?: Record<string, unknown> }, locale?: string) => string'
    ].join('\n')
  })

  addTypeTemplate({
    filename: 'types/content-i18n.d.ts',
    getContents: () => [
      'declare module \'#build/content-i18n.mjs\' {',
      '  export function useLocalePath(): (route: string | { name?: string, hash?: string, params?: Record<string, unknown>, query?: Record<string, unknown> }, locale?: string) => string',
      '}'
    ].join('\n')
  })
}

export const registerUserContentComponents = async (nuxt: Nuxt) => {
  const contentDirectories: Array<{ path: string, global: false, pathPrefix: false, prefix: '' }> = []
  for (const layer of getLayerDirectories(nuxt)) {
    const globalComponents = join(layer.app, 'components/content')
    const dirStat = await fs.promises.stat(globalComponents).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null
      }

      throw error
    })
    if (dirStat && dirStat.isDirectory()) {
      contentDirectories.push({
        path: globalComponents,
        global: false,
        pathPrefix: false,
        prefix: ''
      })
    }
  }
  if (contentDirectories.length) {
    nuxt.hook('components:dirs', (dirs) => {
      dirs.unshift(...contentDirectories)
    })
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
  const serverModuleLiteral = JSON.stringify(resolveRuntimeModuleRoot('./server'))
  const contentServerValueDeclarations = generatedContentServerValueNames.map(name =>
    `  const ${name}: typeof import(${serverModuleLiteral}).${name}`
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
      'import { __ginkoSchemaBrand, __ginkoI18nBrand } from \'@lupinum/ginko-content/config\'',
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
      'type __GeneratedCollectionSchema<TCollection> = TCollection extends { [__ginkoSchemaBrand]: infer TSchema }',
      '  ? TSchema extends { _output: infer TOutput } ? TOutput : {}',
      '  : CollectionSchema<TCollection>',
      'type __GeneratedContentCollectionMap = {',
      '  [K in __ContentCollectionNames]: StrictParsedContent & __GeneratedCollectionSchema<__ContentCollectionExport<K>>',
      '}',
      `type __RuntimeI18nCollectionNames = ${i18nCollectionNameUnion}`,
      'type __InferredI18nCollectionNames = {',
      '  [K in __ContentCollectionNames]: __ContentCollectionExport<K> extends { [__ginkoI18nBrand]: true }',
      '    ? K',
      '    : __ContentCollectionExport<K> extends { i18n: true } ? K : never',
      '}[__ContentCollectionNames]',
      'type __GeneratedI18nCollectionNames = [__RuntimeI18nCollectionNames] extends [never]',
      '  ? __InferredI18nCollectionNames',
      '  : __RuntimeI18nCollectionNames',
      'declare global {',
      '  interface GinkoContentCollectionMap {',
      ...collectionMapProperties,
      '  }',
      '  interface GinkoContentCollectionI18nMap extends Pick<__GeneratedContentCollectionMap, __GeneratedI18nCollectionNames> {}',
      '}',
      'declare module \'#content/server\' {',
      ...contentServerValueDeclarations,
      '}'
    ].filter(Boolean).join('\n')
  })
}
export const registerDevRuntimePlugin = (resolveRuntimeModule: (path: string) => string) => {
  addPlugin(resolveRuntimeModule('./app/plugins/hot-reload.js'))
}
