import defu from 'defu'
import type { StorageValue } from 'unstorage'
import type { ParsedContent } from '../../types/content'
import { useNitroApp } from 'nitropack/runtime'
import { ContentError } from '../../core/errors'
import { transformContent } from '../../parsers'
import { resolveCollection, resolveCollections } from '../../core/content/collection'
import { expandDataLocaleVariants } from '../../core/content/locale'
import { createContentError, validateCollectionDocument } from '../../storage/validation'
import type { ParseContentOptions } from '../../types/runtime'
import type { ContentContext } from '../../types/module'

const loadCustomTransformers = async () => {
  try {
    const specifier = '#content/virtual/' + 'transformers'
    const module = await import(/* @vite-ignore */ specifier)
    return module.transformers || []
  } catch {
    return []
  }
}

const invalidContentError = (id: string, cause: unknown) =>
  new ContentError('INVALID_CONTENT', `Failed to ingest content "${id}"`, { id }, { cause })

const parseSource = async (
  id: string,
  body: StorageValue,
  options: ParseContentOptions
): Promise<ParsedContent> => {
  try {
    return await transformContent(id, body, {
      ...options,
      pathMeta: {
        ...options.pathMeta,
        collectionResolver: (filePath: string) =>
          resolveCollection(filePath, options.pathMeta?.collections, options.pathMeta?.locales || [])
      }
    })
  } catch (cause) {
    throw new ContentError(
      'PARSE_FAILED',
      `Failed to parse content "${id}"`,
      { id },
      { cause }
    )
  }
}

const expandLocaleVariants = async (document: ParsedContent, options: ParseContentOptions) => {
  try {
    const collection = document._collection && options.pathMeta?.collections
      ? options.pathMeta.collections[document._collection]
      : undefined
    return expandDataLocaleVariants(document, collection?.i18n)
  } catch (cause) {
    throw new ContentError(
      'TRANSFORM_FAILED',
      `Failed to transform content "${document._file || document._id}"`,
      { id: document._id, file: document._file },
      { cause }
    )
  }
}

const validateVariants = (
  id: string,
  variants: ParsedContent[],
  options: ParseContentOptions
) => {
  if (options.validate === false) {
    return variants
  }

  try {
    return variants.map((variant) => {
      const outcome = validateCollectionDocument(variant, options.pathMeta?.collections)
      if (!outcome.ok) {
        throw outcome.error
      }
      return outcome.value
    })
  } catch (cause) {
    if (cause instanceof ContentError) {
      throw cause
    }
    throw invalidContentError(id, new ContentError(
      'VALIDATION_FAILED',
      'Failed to validate parsed content',
      {
        files: variants.map(document => document._file || document._id)
      },
      { cause }
    ))
  }
}

/**
 * Ingest a single source file into an array of `ParsedContent` variants
 * (one per locale, including the default).
 *
 * The returned array is the full variant fan-out. Callers that want a
 * specific locale select from it; callers that want the canonical document
 * take `[0]` (see `parseContent` below).
 *
 * Throws a typed `ContentError` on failure — parse errors, transform errors,
 * schema violations, and collection-path ambiguity all surface as specific
 * `ContentErrorCode`s so HTTP and build-time callers can branch on them.
 */
export const parseContentVariants = async (
  id: string,
  content: StorageValue,
  runtimeContentConfig: ContentContext,
  opts: ParseContentOptions = {}
) => {
  const nitroApp = useNitroApp()
  const customTransformers = await loadCustomTransformers()
  const options = defu(
    opts,
    {
      markdown: runtimeContentConfig.markdown,
      csv: runtimeContentConfig.csv,
      yaml: runtimeContentConfig.yaml,
      transformers: customTransformers,
      pathMeta: {
        defaultLocale: runtimeContentConfig.defaultLocale,
        translatedSlugs: runtimeContentConfig.translatedSlugs,
        locales: runtimeContentConfig.locales,
        respectPathCase: runtimeContentConfig.respectPathCase,
        collections: runtimeContentConfig.collections
      }
    }
  )

  const file = { _id: id, body: typeof content === 'string' ? content.replace(/\r\n|\r/g, '\n') : content }
  await nitroApp.hooks.callHook('content:file:beforeParse', file)

  const parsedDocument = await parseSource(id, file.body, options)
  const variants = validateVariants(id, await expandLocaleVariants(parsedDocument, options), options)
  const parsed = variants[0]
  const matchedCollections = resolveCollections(parsed?._file || id, options.pathMeta?.collections, options.pathMeta?.locales || [])
  if (matchedCollections.length > 1) {
    throw createContentError(
      'CONFLICTING_COLLECTION_MATCH',
      parsed?._file || id,
      'conflicting collection matches',
      matchedCollections.join(', '),
      { collections: matchedCollections }
    )
  }

  if (parsed) {
    await nitroApp.hooks.callHook('content:file:afterParse', parsed)
  }

  return variants
}

export const parseContent = async (
  id: string,
  content: StorageValue,
  runtimeContentConfig: ContentContext,
  opts: ParseContentOptions = {}
) => {
  const variants = await parseContentVariants(id, content, runtimeContentConfig, opts)
  return variants[0]
}
