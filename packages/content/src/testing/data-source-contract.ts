import {
  CONTENT_DATA_SOURCE_LIMITS,
  type BoundedContentProviderQuery,
  type ContentDataSource,
} from '../public/data-source'

const positiveInteger = (value: number) => Number.isInteger(value) && value > 0

export async function runContentDataSourceContract<Context>(args: {
  source: ContentDataSource<Context>
  context: Context
  query: BoundedContentProviderQuery
}): Promise<void> {
  const { source, query } = args
  if (!source.name || source.capabilities.protocol !== 'ginko-content-data-source/v1') {
    throw new TypeError('Invalid Content data source identity or protocol.')
  }
  const advertisedLimit = source.capabilities.query.maxPageSize
  if (
    !positiveInteger(advertisedLimit) ||
    advertisedLimit > CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize
  ) {
    throw new RangeError('Content data source max page size exceeds the core ceiling.')
  }
  if (query.plan.mode !== 'count') {
    if (!positiveInteger(query.plan.limit) || query.plan.limit > advertisedLimit) {
      throw new RangeError('Content data source query limit exceeds the advertised page size.')
    }
    if (query.plan.mode === 'all' && query.plan.paging && query.plan.paging.limit !== query.plan.limit) {
      throw new TypeError('Content data source paging limit must equal the query limit.')
    }
  }
  const controller = new AbortController()
  const deadlineAt = Date.now() + CONTENT_DATA_SOURCE_LIMITS.maxBackendDurationMs
  const timeout = setTimeout(() => controller.abort(), CONTENT_DATA_SOURCE_LIMITS.maxBackendDurationMs)
  try {
    const result = await source.query(args.context, query, {
      signal: controller.signal,
      deadlineAt,
    })
    if (!result || typeof result !== 'object' || !('data' in result) || !('cache' in result)) {
      throw new TypeError('Content data source returned an invalid result envelope.')
    }
  } finally {
    clearTimeout(timeout)
  }
}
