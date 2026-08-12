import {
        CONTENT_DATA_SOURCE_LIMITS,
        createContentDataSourceError,
        type ContentDataSource
      } from '@lupinum/ginko-content/data-source'
      import { bindContentProvider } from '@lupinum/ginko-content/provider'

      const documents = [
        {
          collection: 'pages',
          canonicalKey: 'pages:index',
          locale: 'en',
          contentPath: '/',
          body: null,
          title: 'Package Consumer Page'
        },
        {
          collection: 'pages',
          canonicalKey: 'pages:second',
          locale: 'en',
          contentPath: '/second',
          body: null,
          title: 'Second Page'
        }
      ] as const

      const cache = {
        tags: ['content:pages'],
        paths: ['/'],
        maxAge: 60,
        swr: 30,
        etag: 'packed-fixture-v1',
        lastModified: 1_700_000_000_000
      }

      const source = {
        name: 'memory',
        capabilities: {
          protocol: 'ginko-content-data-source/v1',
          query: {
            operators: ['$eq'],
            pagination: ['offset', 'cursor'],
            maxPageSize: CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize
          }
        },
        async query(_context, query) {
          const serialized = JSON.stringify(query.plan)
          if (serialized.includes('/provider-failure')) {
            throw createContentDataSourceError('BACKEND_FAILURE')
          }
          const selected = serialized.includes('/missing')
            ? []
            : serialized.includes('/second')
              ? [documents[1]]
              : [...documents]
          if (query.plan.mode === 'count') return { data: { result: selected.length }, cache }
          if (query.plan.mode === 'first') return { data: { result: selected[0] }, cache }
          if (query.plan.pagination.mode === 'cursor') {
            const start = query.plan.pagination.after === 'page-2' ? 1 : 0
            const result = selected.slice(start, start + query.plan.pagination.limit)
            return {
              data: {
                mode: 'cursor',
                result,
                limit: query.plan.pagination.limit,
                pageInfo: {
                  endCursor: start + result.length < selected.length ? 'page-2' : null,
                  hasNext: start + result.length < selected.length
                }
              },
              cache
            }
          }
          const skip = query.plan.pagination.skip
          const limit = query.plan.pagination.limit ?? 0
          return {
            data: {
              ...(query.plan.pagination.mode === 'offset' ? { mode: 'offset' as const } : {}),
              result: limit ? selected.slice(skip, skip + limit) : selected.slice(skip),
              skip,
              limit,
              total: selected.length
            },
            cache
          }
        },
        async navigation() {
          return {
            data: documents.map(document => ({
              title: document.title,
              route: {
                collection: document.collection,
                canonicalKey: document.canonicalKey,
                locale: document.locale,
                contentPath: document.contentPath
              }
            })),
            cache
          }
        },
        async search(_context, request) {
          return {
            data: documents.slice(0, request.limit).map((document, index) => ({
              title: document.title,
              excerpt: 'Packed provider search result',
              score: 1 - index / 10,
              route: {
                collection: document.collection,
                canonicalKey: document.canonicalKey,
                locale: document.locale,
                contentPath: document.contentPath
              }
            })),
            cache
          }
        },
        async siteData(_context, request) {
          return {
            data: {
              key: request.key,
              locale: request.locale ?? null,
              data: { fixture: 'packed-memory' },
              updatedAt: 1_700_000_000_000
            },
            cache
          }
        },
        async routes(_context, request) {
          const start = request.cursor === 'route-2' ? 1 : 0
          const items = documents.slice(start, start + 1).map(document => ({
            collection: document.collection,
            canonicalKey: document.canonicalKey,
            locale: document.locale,
            contentPath: document.contentPath
          }))
          return {
            data: {
              items,
              nextCursor: start === 0 ? 'route-2' : null,
              snapshot: 'packed-route-inventory-v1'
            },
            cache
          }
        }
      } satisfies ContentDataSource<{ requestId: string }>

      export default bindContentProvider({
        source,
        createContext: async () => ({ requestId: 'packed-consumer' })
      })
    
