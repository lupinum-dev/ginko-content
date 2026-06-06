/**
 * Server-side public API surface (Nitro / H3 contexts).
 *
 * The unified query API (ADR-0016) is the same on the server as on the client
 * — same option shapes, same handle objects, same types. Pure functions are
 * re-exported here for ergonomic discoverability from `@lupinum/ginko-content/server`.
 */
export {
  one,
  many,
  paginate,
  backlinks,
  resolveOne,
  variants,
  tree,
  neighbors,
  createServerContentQueryContext
} from '../runtime/server/query-api.js'

export { getCollectionPath } from '../runtime/query/routes.js'
export type { CollectionPathOptions } from '../runtime/query/routes.js'
export {
  clearAgentMarkdownSerializers,
  blockquoteMarkdown,
  defineAgentMarkdownComponent,
  getMarkdownProp,
  jsonFenceMarkdown,
  linkMarkdown,
  queryMarkdownEnabledContent,
  registerAgentMarkdownComponent,
  registerAgentMarkdownComponents,
  registerAgentMarkdownSerializer,
  registerAgentMarkdownSerializers,
  renderMarkdownChildren,
  resolveAgentMarkdownOptions,
  resolveContentMarkdown,
  resolveContentMarkdownByRoute,
  xmlComponentMarkdown
} from '../runtime/server/agent-markdown.js'
export {
  buildAgentPageIndex,
  collectAgentMarkdownPrerenderRoutes,
  localeFromAgentPath,
  renderAgentMarkdownFrontmatter,
  renderAgentMarkdownPage,
  renderLlmsFullTxt,
  renderLlmsTxt,
  resolveMarkdownForPublicRoute,
  routePathFromIndexSlug,
  routePathFromRawSlug
} from '../runtime/server/agent-site.js'
export type {
  AgentMarkdown,
  AgentMarkdownComponent,
  AgentMarkdownComponentMap,
  AgentMarkdownContext,
  AgentMarkdownMeta,
  AgentMarkdownPublicSignals,
  AgentMarkdownSerializer,
  AgentMarkdownSerializerMap,
  ResolvedAgentMarkdownOptions
} from '../runtime/server/agent-markdown.js'
export type {
  AgentPage,
  AgentPageSource
} from '../runtime/server/agent-site.js'

export type {
  QueryWhere,
  QueryOperators,
  ContentSelector,
  ContentPageResult,
  ContentQueryBuilderParams,
  ContentRouteMeta,
  ContentSearchSection,
  ContentResolvedMeta,
  ContentSitemapEntry,
  BacklinkFields,
  BacklinkSource,
  BacklinksOptions,
  BacklinksResult,
  LocaleFallback,
  DocumentFromHandle,
  OneOptions,
  ManyOptions,
  PaginationOptions,
  PaginationResult,
  PopulateSpec,
  PopulatedDocument,
  ResolveOneOptions,
  ResolveOneResult,
  LocalizedDoc,
  LocalePathEntry,
  NeighborsOptions,
  NeighborsResult,
  SortSpec,
  TreeOptions,
  VariantsOptions,
  ContentVariant
} from '../types/query.js'

export type { ContentQueryResponse } from '../types/api.js'

export const queryCollectionsSitemapEntries: typeof import('../runtime/server/sitemap-provider.js').queryCollectionsSitemapEntries = async (...args) => {
  const { queryCollectionsSitemapEntries } = await import('../runtime/server/sitemap-provider.js')
  return await queryCollectionsSitemapEntries(...args)
}

export { createContentProviderError } from './provider-errors.js'
export {
  contentCacheHeaders,
  noopContentCache,
  vercelContentCache,
  type VercelContentCacheOptions
} from '../runtime/server/cache-adapters.js'
export {
  clearContentCacheHint,
  collectContentCacheHint,
  getContentCacheHint
} from '../runtime/server/cache-hints.js'
export type {
  ContentCacheAdapter,
  ContentCacheHint,
  ContentCacheHintInput,
  ContentCacheInvalidateInput,
  ContentProvider,
  ContentProviderCapabilities,
  ContentProviderResult,
  MaybeContentProviderResult
} from './provider.js'
export { withContentCache } from './provider.js'
export type { ContentProviderErrorCode } from './provider-errors.js'
