import type { Nuxt } from '@nuxt/schema'
import { hash } from 'ohash'
import type { ContentContext, ModuleOptions, ResolvedContentContext } from '../types/module'
import type { ContentConfig } from '../types/config'
import type { PortableComponentPolicyV1 } from '../types/component-policy'
import { collectTopLevelReferenceFieldsByTarget, collectTopLevelSchemaFields } from '../core/references/schema'
import { applyContentRuntimeConfig } from './runtime-config'
import { registerContentSearchServerHandlers } from './server-handlers'
import { assertConfiguredProviderAvailable } from './validation'

interface ContentContextFinalizationOptions {
  nuxt: Nuxt
  options: ModuleOptions
  appContentConfig: ContentConfig
  contentContext: ContentContext
  runtimeRenderPolicies: Record<string, PortableComponentPolicyV1>
  buildIntegrity: number | undefined
  resolveRuntimeModule: (path: string) => string
  onResolved: (context: ResolvedContentContext) => void
}

export const registerContentContextFinalization = ({
  nuxt,
  options,
  appContentConfig,
  contentContext,
  runtimeRenderPolicies,
  buildIntegrity,
  resolveRuntimeModule,
  onResolved
}: ContentContextFinalizationOptions) => {
  nuxt.hook('modules:done', async () => {
    // `content:providers` remains the mutable setup registry: it runs before
    // provider selection is validated so provider integrations can
    // register an implementation name before the check below runs.
    await nuxt.callHook('content:providers', contentContext.providers ||= {})
    assertConfiguredProviderAvailable(contentContext)

    if (contentContext.search !== false) {
      registerContentSearchServerHandlers(options.api.baseURL, contentContext.search, resolveRuntimeModule)
    }

    const resolvedContentContext = {
      ...contentContext,
      defaultLocale: contentContext.localePolicy.defaultLocale,
    } satisfies ResolvedContentContext
    // `resolvedContentContext` is embedded by reference into Nuxt/Nitro
    // runtime config below (module/runtime-config.ts spreads it into the
    // object Nitro normalizes) — Nitro's own runtime-config fallback-value
    // provider recursively assigns onto every object it walks, which throws
    // on a frozen object. Freezing must therefore never reach that shared
    // reference. Give `content:context` observers a distinct shallow-frozen
    // top-level clone instead: dev-mode exposes accidental
    // top-level mutation from observers without touching the object Nitro
    // still needs to write into.
    onResolved(resolvedContentContext)
    const contextForObservers = nuxt.options.dev
      ? Object.freeze({ ...resolvedContentContext })
      : resolvedContentContext
    // `content:context` is a read-only notification called only after the
    // content context is fully resolved. Observers may
    // validate or derive their own artifacts from it; they may not mutate
    // collections, locales, provider selection, or routing policy.
    await nuxt.callHook('content:context', contextForObservers)
    const collectionEntries = Object.entries(contentContext.collections).map(([name, collection]) => {
      const references = collectTopLevelReferenceFieldsByTarget(collection.schema)
      const schemaFields = collectTopLevelSchemaFields(collection.schema)
      const runtimeCollection = {
        ...(collection.source ? { source: collection.source } : {}),
        ...(collection.exclude ? { exclude: collection.exclude } : {}),
        ...(collection.type ? { type: collection.type } : {}),
        strict: collection.strict ?? true,
        ...(collection.route ? { route: collection.route } : {}),
        ...(typeof collection.sitemap === 'boolean' ? { sitemap: collection.sitemap } : {}),
        ...(collection.i18n === false || (collection.i18n && collection.i18n !== true)
          ? { i18n: collection.i18n }
          : {}),
        localePolicy: contentContext.localePolicy.collections[name],
        ...(collection.cms ? { cms: collection.cms } : {}),
        ...(collection.agent ? { agent: collection.agent } : {}),
        ...(Object.keys(references).length ? { references } : {})
      }
      const privateRuntimeCollection = {
        ...runtimeCollection,
        ...(schemaFields ? { schemaFields } : {})
      }
      return [name, runtimeCollection, privateRuntimeCollection] as const
    })
    const runtimeCollections = Object.fromEntries(collectionEntries.map(([name, runtimeCollection]) => [name, runtimeCollection]))
    const privateRuntimeCollections = Object.fromEntries(collectionEntries.map(([name, , privateRuntimeCollection]) => [
      name,
      privateRuntimeCollection
    ]))
    const cacheIntegrity = hash({
      locales: resolvedContentContext.locales,
      defaultLocale: resolvedContentContext.defaultLocale,
      localeFallback: resolvedContentContext.localeFallback,
      translatedSlugs: resolvedContentContext.translatedSlugs,
      strictTranslatedSlugs: resolvedContentContext.strictTranslatedSlugs,
      respectPathCase: resolvedContentContext.respectPathCase,
      collections: runtimeCollections,
      markdown: resolvedContentContext.markdown,
      yaml: resolvedContentContext.yaml,
      csv: resolvedContentContext.csv
    })

    await applyContentRuntimeConfig(
      nuxt,
      options,
      resolvedContentContext,
      appContentConfig,
      runtimeRenderPolicies,
      runtimeCollections,
      privateRuntimeCollections,
      buildIntegrity,
      cacheIntegrity,
    )
  })
}
