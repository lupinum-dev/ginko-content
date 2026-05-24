import type { ParsedContent } from '../../types/content'
import type {
  ContentQueryBuilder,
  ContentQueryRequest,
  ContentQueryBuilderWhere,
  ContentQueryBuilderParams,
  ContentQueryFetcher,
  QueryGroupBuilder,
  QueryGroupFunction,
  QueryOrderDirection,
  QueryOrderOptions
} from '../../types/query'
import type { ContentQueryCountResponse, ContentQueryFindOneResponse, ContentQueryFindResponse } from '../../types/api'
import { ensureArray } from './operators'

/**
 * Immutable fluent builder for `ContentQueryBuilderParams`.
 *
 * Every chainable method returns a fresh builder; no method mutates the
 * instance it was called on. This means:
 *
 *   const base = createContentQueryBuilder(fetcher, { collection: 'docs' }).where('published', '=', true)
 *   base.first()   // builds { ..., first: true } but does not stamp `first` on `base`
 *   base.count()   // builds { ..., count: true } on a separate snapshot
 *   base.params()  // still reflects the pre-first/count state
 *
 * The old builder mutated `queryParams.first = true` before calling the
 * fetcher, so `base.params()` leaked `first: true` forever after. The
 * immutable rewrite removes that foot-gun.
 *
 * To layer adapter-specific normalization (e.g. injecting the active locale
 * at the Nitro boundary), wrap the builder with `wrapQueryBuilder(builder, transform)`.
 * The wrapper returns a Proxy that applies `transform` to every `.params()`
 * result and re-wraps any chainable method return.
 */

type QueryResolvedValue<T> =
  | Array<T>
  | T
  | number
  | undefined

type QueryResponseValue<T> =
  | ContentQueryCountResponse
  | ContentQueryFindResponse<T>
  | ContentQueryFindOneResponse<T>

const resolveQueryResult = <T>(result: QueryResponseValue<T> | T): QueryResolvedValue<T> => {
  if (!result) {
    return result
  }

  if (typeof result === 'object' && 'result' in result) {
    return result.result as QueryResolvedValue<T>
  }

  return result as QueryResolvedValue<T>
}

const arrayParams = ['sort', 'where', 'only', 'without']

interface QueryOptions {
  initialParams?: ContentQueryBuilderParams
}

// Each builder operator maps to a concrete operand shape pulled from
// `ContentQueryBuilderWhere`. Narrowing here — instead of `as any` — keeps the
// internal surface honest: the public `.where(field, operator, value)`
// overloads already validate callers' types; this is the handoff from that
// validated operand into the predicate shape the rest of the pipeline reads.
const buildCondition = (field: string, operator: string, value?: unknown): ContentQueryBuilderWhere => {
  switch (operator) {
    case '=':
      return { [field]: value as ContentQueryBuilderWhere['$eq'] }
    case '!=':
      return { [field]: { $ne: value as ContentQueryBuilderWhere['$ne'] } }
    case '>':
      return { [field]: { $gt: value as ContentQueryBuilderWhere['$gt'] } }
    case '>=':
      return { [field]: { $gte: value as ContentQueryBuilderWhere['$gte'] } }
    case '<':
      return { [field]: { $lt: value as ContentQueryBuilderWhere['$lt'] } }
    case '<=':
      return { [field]: { $lte: value as ContentQueryBuilderWhere['$lte'] } }
    case 'IN':
      return { [field]: { $in: value as ContentQueryBuilderWhere['$in'] } }
    case 'NOT IN':
      return { [field]: { $not: { $in: value as ContentQueryBuilderWhere['$in'] } } }
    case 'CONTAINS':
      return { [field]: { $contains: value as ContentQueryBuilderWhere['$contains'] } }
    case 'CONTAINS_ANY':
      return { [field]: { $containsAny: value as ContentQueryBuilderWhere['$containsAny'] } }
    case 'REGEX':
      return { [field]: { $regex: value as ContentQueryBuilderWhere['$regex'] } }
    case 'ICONTAINS':
      return { [field]: { $icontains: value as ContentQueryBuilderWhere['$icontains'] } }
    case 'EXISTS':
      return { [field]: { $exists: (value ?? true) as ContentQueryBuilderWhere['$exists'] } }
    case 'TYPE':
      return { [field]: { $type: value as ContentQueryBuilderWhere['$type'] } }
    default:
      throw new TypeError(`Unsupported content query operator: ${operator}`)
  }
}

const appendWhere = (
  params: ContentQueryBuilderParams,
  condition: ContentQueryBuilderWhere
): ContentQueryBuilderParams['where'] => {
  const existing = Array.isArray(params.where) ? params.where : params.where ? [params.where] : []
  return [...existing, condition]
}

const appendSort = (
  params: ContentQueryBuilderParams,
  field: string,
  direction: QueryOrderDirection,
  options: QueryOrderOptions = {}
): ContentQueryBuilderParams['sort'] => {
  const existing = Array.isArray(params.sort) ? params.sort : params.sort ? [params.sort] : []
  return [
    ...existing,
    {
      [field]: direction === 'DESC' ? -1 : 1,
      ...(options.locale ? { $locale: options.locale } : {}),
      ...(typeof options.numeric === 'boolean' ? { $numeric: options.numeric } : {}),
      ...(options.caseFirst ? { $caseFirst: options.caseFirst } : {}),
      ...(options.sensitivity ? { $sensitivity: options.sensitivity } : {})
    }
  ]
}

/**
 * Build a read-only group condition. Groups are terminal shapes (they flatten
 * to a `$and` / `$or` node) so they're safe to keep as a mini-mutable builder
 * — they don't leak into the parent's state.
 */
const buildGroup = <T>(): QueryGroupBuilder<T> & {
  toCondition: (type?: '$and' | '$or') => ContentQueryBuilderWhere | null
} => {
  const conditions: ContentQueryBuilderWhere[] = []

  const pushCondition = (condition: ContentQueryBuilderWhere) => {
    conditions.push(condition)
    return group
  }

  const wrap = (type: '$and' | '$or', groupFactory: QueryGroupFunction<T>) => {
    const nested = buildGroup<T>()
    groupFactory(nested)
    const condition = nested.toCondition(type)
    if (condition) {
      conditions.push(condition)
    }
    return group
  }

  const group: QueryGroupBuilder<T> & {
    toCondition: (type?: '$and' | '$or') => ContentQueryBuilderWhere | null
  } = {
    where: (field, operator, value) => pushCondition(buildCondition(String(field), operator as string, value)),
    andWhere: groupFactory => wrap('$and', groupFactory),
    orWhere: groupFactory => wrap('$or', groupFactory),
    toCondition: (type = '$and') => {
      if (conditions.length === 0) {
        return null
      }

      if (conditions.length === 1) {
        return conditions[0]!
      }

      return { [type]: conditions }
    }
  }

  return group
}

export function createQuery <T = ParsedContent> (fetcher: ContentQueryFetcher<T>, opts: QueryOptions = {}): ContentQueryBuilder<T> {
  // Normalize initial params: arrayParams are coerced to arrays so downstream
  // code can assume `Array.isArray(params.where)` etc.
  const queryParams: ContentQueryBuilderParams = {}
  for (const key of Object.keys(opts.initialParams || {})) {
    queryParams[key] = arrayParams.includes(key) ? ensureArray(opts.initialParams![key]) : opts.initialParams![key]
  }

  // Produce a child builder with a shallow-merged param delta. This is the
  // single entry point by which the immutable API rebuilds — every chainable
  // method below funnels through `next`.
  const next = (changes: Partial<ContentQueryBuilderParams>): ContentQueryBuilder<T> =>
    createQuery<T>(fetcher, { initialParams: { ...queryParams, ...changes } })

  const query: any = {
    params: () => ({
      ...queryParams,
      ...(queryParams.where ? { where: [...ensureArray(queryParams.where)] } : {}),
      ...(queryParams.sort ? { sort: [...ensureArray(queryParams.sort)] } : {})
    }),
    where: (field: string | ContentQueryBuilderWhere, operator?: string, value?: unknown) => {
      const condition = typeof field === 'object' && field
        ? field
        : buildCondition(field as string, operator as string, value)
      return next({ where: appendWhere(queryParams, condition) })
    },
    andWhere: (groupFactory: QueryGroupFunction<T>) => {
      const group = buildGroup<T>()
      groupFactory(group)
      const resolved = group.toCondition()
      return resolved ? next({ where: appendWhere(queryParams, resolved) }) : query
    },
    orWhere: (groupFactory: QueryGroupFunction<T>) => {
      const group = buildGroup<T>()
      groupFactory(group)
      const resolved = group.toCondition('$or')
      return resolved ? next({ where: appendWhere(queryParams, resolved) }) : query
    },
    select: (...fields: string[]) => {
      const only = Array.isArray(queryParams.only) ? queryParams.only : queryParams.only ? [queryParams.only] : []
      return next({ only: [...only, ...fields] })
    },
    order: (field: string, direction: QueryOrderDirection, options?: QueryOrderOptions) => {
      return next({ sort: appendSort(queryParams, field, direction, options) })
    },
    limit: (value: number) => next({ limit: parseInt(String(value), 10) }),
    skip: (value: number) => next({ skip: parseInt(String(value), 10) }),
    // Terminal methods: build a transient snapshot with the terminal flag and
    // hand it to the fetcher. We deliberately do NOT mutate `queryParams` — so
    // calling `.first()` on a shared base query does not leak `first: true`
    // back into subsequent `.count()` / `.all()` calls on that same base.
    //
    // These are non-arrow methods so `this` binds to the call site's receiver.
    // When a `wrapQueryBuilder` Proxy wraps this builder, the Proxy is the
    // receiver — so `this.params()` flows through the Proxy's transform.
    // Without this, adapter-level normalization (locale injection, draft
    // filters) would be silently skipped at the terminal methods.
    all (this: ContentQueryBuilder<T>) {
      return fetcher(this).then(resolveQueryResult)
    },
    find (this: ContentQueryBuilder<T>) {
      return fetcher(this).then(resolveQueryResult)
    },
    first (this: ContentQueryBuilder<T>) {
      // Build a transient snapshot carrying `first: true`. We deliberately
      // avoid mutating the current builder's params (the old API's foot-gun).
      // The fetcher only needs `.params()`, so the terminal boundary accepts a
      // minimal request snapshot instead of pretending this is a full builder.
      const snapshot: ContentQueryRequest = { params: () => ({ ...this.params(), first: true }) }
      return fetcher(snapshot).then(resolveQueryResult)
    },
    count (this: ContentQueryBuilder<T>) {
      const snapshot: ContentQueryRequest = { params: () => ({ ...this.params(), count: true }) }
      return fetcher(snapshot).then(resolveQueryResult)
    },
    locale: (_locale: string, options?: { fallback?: boolean | string[] }) => {
      // When applying a locale, we also strip any existing `_locale` predicates
      // from `where` so `.locale(x)` is always the authoritative scope. The
      // filter produces a new array rather than mutating the existing one.
      const filteredWhere = queryParams.where
        ? ensureArray(queryParams.where).filter(item => typeof item._locale === 'undefined')
        : undefined

      return next({
        resolveLocale: {
          locale: _locale,
          fallback: Array.isArray(options?.fallback) ? options?.fallback : Boolean(options?.fallback),
          exact: !options?.fallback
        },
        ...(filteredWhere !== undefined ? { where: filteredWhere } : {})
      })
    }
  }

  return query as ContentQueryBuilder<T>
}

/**
 * Wrap a query builder so every `.params()` result passes through `transform`
 * and every chainable return value is itself wrapped. The wrapper is a Proxy —
 * it does not mutate or patch the underlying builder, so the immutable
 * guarantee above holds end-to-end.
 *
 * Adapters use this to layer transport-specific normalization (server: inject
 * active locale from request context; app: resolve draft filter from
 * `import.meta.dev`) without coupling the pure core builder to either transport.
 */
export const wrapQueryBuilder = <T = ParsedContent>(
  inner: ContentQueryBuilder<T>,
  transform: (params: ContentQueryBuilderParams) => ContentQueryBuilderParams
): ContentQueryBuilder<T> => new Proxy(inner, {
  get (target, key, receiver) {
    if (key === 'params') {
      return () => transform((target as ContentQueryBuilder<T>).params())
    }

    const value = Reflect.get(target, key, receiver)
    if (typeof value !== 'function') {
      return value
    }

    return (...args: unknown[]) => {
      // Bind `this` to the Proxy (receiver), not the raw inner target. Terminal
      // methods (`all`/`find`/`first`/`count`) read `this.params()` to capture
      // the *transformed* params — if we bound to `target` the adapter's
      // locale/draft normalization would be silently skipped at the fetcher.
      const returned = Reflect.apply(value as (...args: unknown[]) => unknown, receiver, args)
      // Chainable methods return a builder; terminal ones return a promise.
      // We re-wrap the former so the transform stays attached through the chain.
      if (returned && typeof returned === 'object' && 'params' in (returned as object) && typeof (returned as ContentQueryBuilder<T>).params === 'function') {
        return wrapQueryBuilder(returned as ContentQueryBuilder<T>, transform)
      }
      return returned
    }
  }
}) as ContentQueryBuilder<T>
