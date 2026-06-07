import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import type { Nuxt } from '@nuxt/schema'
import type { addTemplate } from '@nuxt/kit'
import { genImport, genSafeVariableName } from 'knitwork'
import { hash } from 'ohash'
import { relative } from 'pathe'

import type { ContentContext } from '../types/module'

const require = createRequire(import.meta.url)
const jitiImportSpecifier = pathToFileURL(require.resolve('jiti')).href

export const createVirtualContentTemplates = (
  contentContext: ContentContext,
  nuxt: Nuxt,
  contentConfigPath: string | undefined,
  addTemplateImpl: typeof addTemplate
) => {
  // These files must exist on disk and be aliased for both Nuxt and Nitro.
  // The package runtime imports `#content/virtual/*` from built dist output,
  // so in-memory-only virtual templates are not enough for consuming apps/tests.
  const transformersTemplate = addTemplateImpl({
    filename: 'content/virtual-transformers.mjs',
    write: true,
    getContents: () => {
      const transformers = contentContext.transformers.map((transformer) => {
        const name = genSafeVariableName(relative(nuxt.options.rootDir, transformer)).replace(/_(45|46|47)/g, '_') + '_' + hash(transformer)
        return { name, import: genImport(transformer, name) }
      })

      return [
        ...transformers.map(transformer => transformer.import),
        `export const transformers = [${transformers.map(transformer => transformer.name).join(', ')}]`,
        'export const getParser = (ext) => transformers.find(p => ext.match(new RegExp(p.extensions.join("|"),  "i")) && p.parse)',
        'export const getTransformers = (ext) => transformers.filter(p => ext.match(new RegExp(p.extensions.join("|"),  "i")) && p.transform)',
        'export default () => {}'
      ].join('\n')
    }
  }).dst

  const virtualConfigTemplate = addTemplateImpl({
    filename: 'content/virtual-config.mjs',
    write: true,
    getContents: () => contentConfigPath
      ? [
          `import jiti from ${JSON.stringify(jitiImportSpecifier)}`,
          `const importer = jiti(import.meta.url, { interopDefault: true })`,
          `const config = await importer.import(${JSON.stringify(contentConfigPath)})`,
          'export default config?.default || config || {}'
        ].join('\n')
      : 'export default {}'
  }).dst

  const virtualProvidersTemplate = addTemplateImpl({
    filename: 'content/virtual-providers.mjs',
    write: true,
    getContents: () => {
      const providers = Object.entries(contentContext.providers || {})
      const cases = providers.map(([name, specifier]) => {
        return `case ${JSON.stringify(name)}: return import(${JSON.stringify(specifier)}).then(resolveProviderModule)`
      })

      return [
        'const resolveProviderModule = (mod) => mod.default || mod.contentProvider || mod.provider',
        'export const externalContentProviderNames = ' + JSON.stringify(providers.map(([name]) => name)),
        'export const loadExternalContentProvider = (name) => {',
        '  switch (name) {',
        ...cases.map(item => `    ${item}`),
        '    default: return undefined',
        '  }',
        '}',
        'export default {}'
      ].join('\n')
    }
  }).dst

  const virtualCacheAdapterTemplate = addTemplateImpl({
    filename: 'content/virtual-cache-adapter.mjs',
    write: true,
    getContents: () => {
      const cache = contentContext.cache
      if (!cache) {
        return [
          'export const loadContentCacheAdapter = () => undefined',
          'export default {}'
        ].join('\n')
      }

      return [
        'const resolveCacheAdapterModule = (mod) => mod.default || mod.contentCacheAdapter || mod.cacheAdapter',
        `export const loadContentCacheAdapter = () => import(${JSON.stringify(cache)}).then(resolveCacheAdapterModule)`,
        'export default {}'
      ].join('\n')
    }
  }).dst

  return {
    transformersTemplate,
    virtualConfigTemplate,
    virtualProvidersTemplate,
    virtualCacheAdapterTemplate
  }
}

export const registerVirtualContentAliases = (
  nuxt: Nuxt,
  transformersTemplate: string,
  virtualConfigTemplate: string,
  virtualProvidersTemplate: string,
  virtualCacheAdapterTemplate: string,
  resolveRuntimeModule: (path: string) => string
) => {
  nuxt.options.alias = nuxt.options.alias || {}
  nuxt.options.alias['#content/virtual/transformers'] = transformersTemplate
  nuxt.options.alias['#content/virtual/config'] = virtualConfigTemplate
  nuxt.options.alias['#content/virtual/providers'] = virtualProvidersTemplate
  nuxt.options.alias['#content/virtual/cache-adapter'] = virtualCacheAdapterTemplate

  ;(nuxt.hook as any)('nitro:config', (nitroConfig: any) => {
    nitroConfig.alias = nitroConfig.alias || {}
    nitroConfig.alias['#content/server'] = resolveRuntimeModule('./server/index.js')
    nitroConfig.alias['#content/virtual/transformers'] = transformersTemplate
    nitroConfig.alias['#content/virtual/config'] = virtualConfigTemplate
    nitroConfig.alias['#content/virtual/providers'] = virtualProvidersTemplate
    nitroConfig.alias['#content/virtual/cache-adapter'] = virtualCacheAdapterTemplate
  })
}
