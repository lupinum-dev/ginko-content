import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  ContentVariant,
  LocalizedContentDocument,
  OneOptions,
  VariantsOptions
} from '../../types/query'
import type { ContentQueryContext } from './context'
import { ensureCollectionName } from './handles'
import { collectionDefaultLocale, collectionLocales } from './locale-options'

type OneResolver = <H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: OneOptions<H>
) => Promise<LocalizedContentDocument<ParsedContent> | null>

export async function resolveVariants<H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  one: OneResolver,
  handle: H,
  options: VariantsOptions<H>
): Promise<Array<ContentVariant<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  const locales = collectionLocales(collection, runtime)
  const defaultLocale = collectionDefaultLocale(collection, runtime)
  const requestedLocales = options.locales?.length ? options.locales : locales
  if (!requestedLocales.length) {
    return []
  }

  const seed = await one(context, handle, {
    by: options.by,
    locale: options.locale || defaultLocale,
    fallback: true
  } as unknown as OneOptions<H>)
  if (!seed) return []

  const variantPaths = seed._variantPaths || {}
  const sourceLocale = seed.locale || defaultLocale || ''

  return requestedLocales.map((locale) => {
    const variantPath = variantPaths[locale]
    if (variantPath) {
      return {
        locale,
        path: seed.localePaths[locale]?.path || variantPath,
        translated: true
      } as ContentVariant
    }
    return {
      locale,
      path: seed.path,
      translated: false,
      fallback: sourceLocale
    } as ContentVariant
  }) as Array<ContentVariant<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>>
}
