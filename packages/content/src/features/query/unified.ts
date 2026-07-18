/**
 * Layer 1 of the unified query API (ADR-0016).
 *
 * Context-explicit async functions: `one`, `many`, `resolveOne`, `paginate`,
 * `backlinks`, `surround`, `navigation` — the exact six verbs plus
 * `navigation()`. Each accepts a typed collection handle
 * (from `defineCollection`) plus an options object. Locale is type-required
 * when the handle declares i18n.
 *
 * Implementation strategy: compile the public `by` / `where` options to an
 * internal `ContentProviderQueryInput` payload via `compileQueryParams`, then
 * dispatch through the explicit `ContentQueryContext` transport provided by
 * the client or server entrypoint.
 *
 * Documents are decorated with the canonical `route` and `resolution`
 * envelopes, including locale alternates for zero-round-trip switching.
 */
import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle, __ginkoSchemaBrand } from '../../types/config'
import type {
  BacklinkSource,
  BacklinksOptions,
  BacklinksResult,
  ContentNavigationTreeItem,
  DocumentFromHandle,
  ManyOptions,
  LocalizedDoc,
  NavigationOptions,
  OneOptions,
  OptionsArg,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  PaginationOptions,
  PaginationResultFor,
  ResolveOneOptions,
  ResolveOneResult,
  SurroundOptions,
  SurroundResult
} from '../../types/query'
import type { ContentQueryContext } from './context'
import { resolveBacklinks } from './backlinks'
import { resolveNavigation, resolveSurround } from './navigation'
import { resolvePagination } from './pagination'
import { resolveDocument, resolveDocumentOnly, resolveManyDocuments } from './documents'

export type { ContentQueryContext, ContentQueryEndpoint, RuntimeContentConfig } from './context'
export { navigationSelectFields } from './navigation'

/* -------------------------------------------------------------------------- */
/* resolveOne / one                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Resolve exactly one document and return an explanation of how it matched.
 */
export async function resolveOne<
  const H extends ContentCollectionHandle | string,
  O extends ResolveOneOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O
): Promise<ResolveOneResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return resolveDocument(context, one, handle, options)
}

/**
 * Ergonomic doc-only view over `resolveOne`.
 */
export async function one<
  const H extends ContentCollectionHandle | string,
  O extends OneOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O
): Promise<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>> | null> {
  return resolveDocumentOnly(context, handle, options)
}

/* -------------------------------------------------------------------------- */
/* many                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a list of documents matching the filter. Always returns an array.
 */
export async function many<
  const H extends ContentCollectionHandle | string,
  O extends ManyOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  ...args: OptionsArg<H, O>
): Promise<Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>> {
  const options = (args[0] ?? {}) as O
  return resolveManyDocuments(context, one, handle, options)
}

/* -------------------------------------------------------------------------- */
/* paginate                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Resolve one page of documents and preserve the query envelope metadata.
 * The return type narrows to the exact offset/cursor discriminant when the
 * caller's options literally name `mode`.
 */
export async function paginate<
  const H extends ContentCollectionHandle | string,
  O extends PaginationOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O
): Promise<PaginationResultFor<O, PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return resolvePagination(context, one, handle, options) as unknown as PaginationResultFor<O, PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
}

/* -------------------------------------------------------------------------- */
/* backlinks                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Resolve documents in source collections that reference one target document.
 */
export async function backlinks<
  const Target extends ContentCollectionHandle | string,
  const Source extends BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
>(
  context: ContentQueryContext,
  targetHandle: Target,
  options: BacklinksOptions<Target, Source, P>
): Promise<BacklinksResult<Source, P>> {
  return resolveBacklinks(context, one, many, targetHandle, options)
}

/* -------------------------------------------------------------------------- */
/* navigation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the navigation tree for a collection. The shape mirrors the
 * provider navigation query but is a thin builder over the same transport.
 *
 * Locale fallback is on-by-default: every doc appears in the tree even when
 * it has no variant in the requested locale (the resolver substitutes the
 * fallback locale's path). This keeps sidebars complete when the requested
 * locale does not contain every document.
 */
export async function navigation<
  H extends ContentCollectionHandle | string,
  Select extends ReadonlyArray<string> | undefined = undefined
>(
  context: ContentQueryContext,
  handle: H,
  ...args: OptionsArg<H, Omit<NavigationOptions<H>, 'select'> & { select?: Select }>
): Promise<ContentNavigationTreeItem<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent, Select>[]> {
  const options = (args[0] ?? {}) as Omit<NavigationOptions<H>, 'select'> & { select?: Select }
  return resolveNavigation(context, handle, options)
}

/* -------------------------------------------------------------------------- */
/* surround                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Return the previous/next navigation entries surrounding a document.
 */
export async function surround<H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: SurroundOptions<H>
): Promise<SurroundResult<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  return resolveSurround(context, one, navigation, handle, options)
}
