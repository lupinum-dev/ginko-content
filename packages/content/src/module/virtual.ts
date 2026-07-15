import type { Nuxt } from '@nuxt/schema'
import type { addTemplate } from '@nuxt/kit'
import { genImport, genSafeVariableName } from 'knitwork'
import { hash } from 'ohash'
import { relative } from 'pathe'
import { fileURLToPath } from 'node:url'

import type { ContentContext } from '../types/module'

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
        // hash() can emit base64url chars ('-') that are invalid in JS
        // identifiers — sanitize, or the generated module is a syntax error
        // the moment anything actually bundles it (caught when the ingest
        // import became static and rollup parsed this template for the
        // first time).
        const name = genSafeVariableName(relative(nuxt.options.rootDir, transformer)).replace(/_(45|46|47)/g, '_') + '_' + hash(transformer).replace(/[^a-z0-9_$]/gi, '_')
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
    getContents: () => {
      if (!contentConfigPath) {
        return 'export default {}'
      }

      return [
        `import config from ${JSON.stringify(contentConfigPath)}`,
        'export default config'
      ].join('\n')
    }
  }).dst

  const virtualProvidersTemplate = addTemplateImpl({
    filename: 'content/virtual-providers.mjs',
    write: true,
    getContents: () => {
      const providers = Object.entries(contentContext.providers || {})
      const imports = providers.map(([, specifier], index) => {
        const importPath = specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier
        return `import * as provider${index} from ${JSON.stringify(importPath)}`
      })
      const entries = providers.map(
        ([name], index) => `${JSON.stringify(name)}: resolveProviderModule(provider${index})`
      )

      return [
        ...imports,
        'const resolveProviderModule = (mod) => mod.default || mod.contentProvider || mod.provider',
        `const providers = { ${entries.join(', ')} }`,
        'export const externalContentProviderNames = ' +
          JSON.stringify(providers.map(([name]) => name)),
        'export const loadExternalContentProvider = async name => providers[name]',
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
