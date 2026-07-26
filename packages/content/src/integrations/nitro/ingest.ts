import defu from 'defu'
import type { StorageValue } from 'unstorage'
import type { ParsedContent } from '../../types/content'
import { useNitroApp } from 'nitropack/runtime'
import { ContentError } from '../../core/errors'
import { transformContent } from '../../parsers'
import { resolveCollections } from '../../core/content/collection'
import { expandDataLocaleVariants } from '../../core/content/locale'
import { createContentError, validateCollectionDocument, validateDocumentJsonPurity } from '../../storage/validation'
import type { ParseContentOptions } from '../../types/runtime'
import type { ResolvedContentContext } from '../../types/module'

// Static import through the build-time alias, matching the sibling virtuals
// (#content/virtual/config, #content/virtual/providers). The previous
// obfuscated dynamic import ('#content/virtual/' + 'transformers') could never
// resolve in the bundled Nitro server, so custom transformers silently loaded
// only in dev — caught by the snapshot completeness assertion building
// examples/advanced/transformer.
import { transformers as customContentTransformers } from '#content/virtual/transformers'

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
          resolveCollections(
            filePath,
            options.pathMeta?.collections,
            options.pathMeta?.locales || []
          )[0]
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
    const collection = document.collection && options.pathMeta?.collections
      ? options.pathMeta.collections[document.collection]
      : undefined
    return expandDataLocaleVariants(
      document,
      collection?.i18n && collection.i18n !== true ? collection.i18n : undefined
    )
  } catch (cause) {
    throw new ContentError(
      'TRANSFORM_FAILED',
      `Failed to transform content "${document.file?.path || document.id}"`,
      { id: document.id, file: document.file?.path },
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

      // Canonical JSON-purity gate: runs after schema parsing, before this
      // document can reach graph insertion. Same validator
      // as the provider-document seam and the snapshot's defensive check.
      const jsonOutcome = validateDocumentJsonPurity(outcome.value)
      if (!jsonOutcome.ok) {
        throw jsonOutcome.error
      }

      return jsonOutcome.value
    })
  } catch (cause) {
    if (cause instanceof ContentError) {
      throw cause
    }
    throw invalidContentError(id, new ContentError(
      'VALIDATION_FAILED',
      'Failed to validate parsed content',
      {
        files: variants.map(document => document.file?.path || document.id)
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
  runtimeContentConfig: ResolvedContentContext,
  opts: ParseContentOptions = {}
) => {
  const nitroApp = useNitroApp()
  const customTransformers = customContentTransformers || []
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
        collections: runtimeContentConfig.collections,
        localePolicy: runtimeContentConfig.localePolicy.collections
      }
    }
  ) as unknown as ParseContentOptions

  const file = { id: id, body: typeof content === 'string' ? content.replace(/\r\n|\r/g, '\n') : content }
  await nitroApp.hooks.callHook('content:file:beforeParse', file)

  const parsedDocument = await parseSource(id, file.body, options)
  const variants = validateVariants(id, await expandLocaleVariants(parsedDocument, options), options)
  const parsed = variants[0]
  const matchedCollections = resolveCollections(
    parsed?.file?.path || id,
    options.pathMeta?.collections,
    options.pathMeta?.locales || []
  )
  if (matchedCollections.length > 1) {
    throw createContentError(
      'CONFLICTING_COLLECTION_MATCH',
      parsed?.file?.path || id,
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
  runtimeContentConfig: ResolvedContentContext,
  opts: ParseContentOptions = {}
) => {
  const variants = await parseContentVariants(id, content, runtimeContentConfig, opts)
  return variants[0]
}
