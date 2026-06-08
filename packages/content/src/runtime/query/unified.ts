/**
 * Layer 1 of the unified query API (ADR-0016).
 *
 * Context-explicit async functions: `one`, `many`, `resolveOne`, `variants`, `tree`, `neighbors`.
 * Each accepts a typed collection handle (from `defineCollection`) plus an
 * options object. Locale is type-required when the handle declares i18n.
 *
 * Implementation strategy: compile the public `by` / `where` options to an
 * internal `ContentQueryBuilderParams` payload via `compileQueryParams`, then
 * dispatch through the explicit `ContentQueryContext` transport provided by
 * the client or server entrypoint.
 *
 * Documents are post-processed by `localizePageResult` to attach `path`,
 * `locale`, `localePaths`, and `variants` — the route metadata that powers
 * locale switching with zero extra round trips.
 */
import type { ParsedContent } from '../../types/content'
import type {
  ContentCollectionHandle
} from '../../types/config'
import type {
  BacklinkSource,
  BacklinksOptions,
  BacklinksResult,
  ContentTreeItem,
  DocumentFromHandle,
  ManyOptions,
  LocalizedDoc,
  NeighborsOptions,
  NeighborsResult,
  OneOptions,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  PaginationOptions,
  PaginationResult,
  ResolveOneOptions,
  ResolveOneResult,
  TreeOptions,
  ContentVariant,
  VariantsOptions
} from '../../types/query'
import type { ContentQueryContext } from './context'
import { resolveBacklinks } from './backlinks'
import { resolveNeighbors, resolveTree } from './navigation'
import { resolvePagination } from './pagination'
import { resolveVariants } from './variants'
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
  options: O = {} as O
): Promise<Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>> {
  return resolveManyDocuments(context, one, handle, options)
}

/* -------------------------------------------------------------------------- */
/* paginate                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Resolve one page of documents and preserve the query envelope metadata.
 */
export async function paginate<
  const H extends ContentCollectionHandle | string,
  O extends PaginationOptions<H, PopulateSpec | undefined>
>(
  context: ContentQueryContext,
  handle: H,
  options: O
): Promise<PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return resolvePagination(context, one, handle, options)
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
/* variants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Enumerate every locale variant of one document. Identifies the document by
 * either its stable `ref:` or its canonical/localized `path`.
 *
 * Each entry carries a `translated: boolean` flag — `true` when that locale
 * has its own variant on disk, `false` when the resolver fell back to another
 * locale's path. `fallback` names the source locale when `translated` is false.
 */
export async function variants<H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: VariantsOptions<H>
): Promise<Array<ContentVariant<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>>> {
  return resolveVariants(context, one, handle, options)
}

/* -------------------------------------------------------------------------- */
/* tree                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the navigation tree for a collection. The shape mirrors
 * the provider navigation query but is a thin builder over the same transport.
 *
 * Locale fallback is on-by-default: every doc appears in the tree even when
 * it has no variant in the requested locale (the resolver substitutes the
 * fallback locale's path). This matches legacy navigation semantics —
 * sidebars are inherently lossy when filtered too strictly.
 */
export async function tree<
  H extends ContentCollectionHandle | string,
  Fields extends ReadonlyArray<string> | undefined = undefined
>(
  context: ContentQueryContext,
  handle: H,
  options: Omit<TreeOptions<H>, 'fields'> & { fields?: Fields } = {} as Omit<TreeOptions<H>, 'fields'> & { fields?: Fields }
): Promise<ContentTreeItem<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent, Fields>[]> {
  return resolveTree(context, handle, options)
}

/* -------------------------------------------------------------------------- */
/* neighbors                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Return the previous/next navigation entries surrounding a document.
 */
export async function neighbors<H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: NeighborsOptions<H>
): Promise<NeighborsResult<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  return resolveNeighbors(context, one, tree, handle, options)
}
