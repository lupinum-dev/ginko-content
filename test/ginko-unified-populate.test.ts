import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineCollection, defineContentConfig, reference } from '../packages/content/src/types/config'
import { backlinks, one, paginate } from '../packages/content/src/features/query/unified'
import { populateQueryResponse } from '../packages/content/src/features/query/populate'
import type { RuntimeContentConfig } from '../packages/content/src/features/query/context'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  transport: vi.fn()
}))

const publicDocument = (value: Record<string, any>, params: Record<string, any>) => {
  if (value.route?.resolvedPath && value.resolution) return value
  const { path = '/', resolved, ...document } = value
  const locale = resolved?.locale || value.locale || params.resolveVariant?.locale || params.resolveLocale?.locale || 'en'
  const requestedLocale = params.resolveVariant?.locale || params.resolveLocale?.locale
  return {
    ...document,
    locale,
    route: {
      ...(params.resolveVariant?.route ? { requestedPath: params.resolveVariant.route } : {}),
      resolvedPath: path,
      alternates: []
    },
    resolution: {
      requested: requestedLocale ? { locale: requestedLocale } : {},
      resolved: { locale },
      usedFallback: Boolean(requestedLocale && requestedLocale !== locale)
    }
  }
}

const transport = async (endpoint: string, params: Record<string, any>) => {
  const response = await mocks.transport(endpoint, params)
  if (endpoint !== 'query' || !response || typeof response !== 'object' || !('result' in response)) return response
  const result = response.result
  return {
    ...response,
    result: Array.isArray(result)
      ? result.map(document => publicDocument(document, params))
      : result && typeof result === 'object'
        ? publicDocument(result, params)
        : result
  }
}

const createContext = (runtime: RuntimeContentConfig = {}) => {
  const context = {
    runtime,
    transport: async (endpoint: 'query' | 'navigation', params: Record<string, any>) =>
      await populateQueryResponse(context as any, one, await transport(endpoint, params), params)
  }
  return context
}

const contentConfig = defineContentConfig({
  collections: {
    authors: defineCollection({
      type: 'data',
      source: 'authors/*.yml',
      schema: z.object({
        name: z.string()
      })
    }),
    posts: defineCollection({
      type: 'page',
      source: 'posts/*.md',
      schema: z.object({
        title: z.string(),
        authors: z.array(reference('authors'))
      })
    }),
    docs: defineCollection({
      type: 'page',
      source: 'docs/*.md',
      schema: z.object({
        title: z.string(),
        relatedAuthor: reference('authors').optional(),
        relatedPost: reference('posts').optional()
      })
    }),
    localizedAuthors: defineCollection({
      type: 'page',
      source: 'localized-authors/*.md',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      schema: z.object({
        title: z.string(),
        name: z.string()
      })
    }),
    localizedPosts: defineCollection({
      type: 'page',
      source: 'localized-posts/*.md',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      schema: z.object({
        title: z.string(),
        primaryAuthor: reference('localizedAuthors').optional()
      })
    })
  }
})

const { authors, posts, docs, localizedAuthors, localizedPosts } = contentConfig.collections

describe('unified query populate', () => {
  beforeEach(() => {
    mocks.transport.mockReset()
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'posts') {
        return {
          result: {
            id: 'content:posts:hello.md',
            path: '/hello',
            collection: 'posts',
            title: 'Hello',
            authors: ['authors.ada'],
            body: null
          }
        }
      }

      if (params.collection === 'authors') {
        return {
          result: {
            id: 'content:authors:ada.yml',
            path: '/authors/ada',
            collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      return null
    })
  })

  test('resolves explicit reference fields through target collection handles', async () => {
    const context = createContext()
    const post = await one(context, posts, {
      by: { path: '/hello' },
      select: ['title'],
      populate: { authors }
    })

    expect(post?.authors).toEqual([
      expect.objectContaining({
        name: 'Ada',
        route: expect.objectContaining({ resolvedPath: '/authors/ada' }),
        resolution: expect.objectContaining({ usedFallback: false })
      })
    ])

    expect(mocks.transport).toHaveBeenCalledTimes(2)
    expect(mocks.transport.mock.calls[0]?.[1]).toMatchObject({
      collection: 'posts',
      first: true,
      only: expect.arrayContaining(['title', 'authors', 'path', 'file', 'canonicalKey', 'locale'])
    })
    expect(mocks.transport.mock.calls[1]?.[1]).toMatchObject({
      collection: 'authors',
      first: true,
      resolveVariant: { ref: 'authors.ada' }
    })
  })

  test('resolves a singular data reference when the field name differs from the target collection', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'docs') {
        return {
          result: {
            id: 'content:docs:guide.md',
            path: '/docs/guide',
            collection: 'docs',
            title: 'Guide',
            relatedAuthor: 'authors.ada',
            body: null
          }
        }
      }

      if (params.collection === 'authors') {
        return {
          result: {
            id: 'content:authors:ada.yml',
            path: '/authors/ada',
            collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      return null
    })

    const doc = await one(createContext(), docs, {
      by: { path: '/docs/guide' },
      select: ['title'],
      populate: { relatedAuthor: authors }
    })

    expect(doc?.relatedAuthor).toMatchObject({
      name: 'Ada',
      route: expect.objectContaining({ resolvedPath: '/authors/ada' })
    })
    expect(mocks.transport.mock.calls[0]?.[1]).toMatchObject({
      collection: 'docs',
      first: true,
      only: expect.arrayContaining(['title', 'relatedAuthor', 'path', 'file', 'canonicalKey', 'locale'])
    })
    expect(mocks.transport.mock.calls[1]?.[1]).toMatchObject({
      collection: 'authors',
      first: true,
      resolveVariant: { ref: 'authors.ada' }
    })
  })

  test('resolves a route-backed page reference when the field name differs from the target collection', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'docs') {
        return {
          result: {
            id: 'content:docs:guide.md',
            path: '/docs/guide',
            collection: 'docs',
            title: 'Guide',
            relatedPost: 'posts.hello',
            body: null
          }
        }
      }

      if (params.collection === 'posts') {
        return {
          result: {
            id: 'content:posts:hello.md',
            path: '/hello',
            collection: 'posts',
            ref: 'posts.hello',
            title: 'Hello',
            authors: [],
            body: null
          }
        }
      }

      return null
    })

    const doc = await one(createContext(), docs, {
      by: { path: '/docs/guide' },
      populate: { relatedPost: posts }
    })

    expect(doc?.relatedPost).toMatchObject({
      title: 'Hello',
      route: expect.objectContaining({ resolvedPath: '/hello' })
    })
    expect(mocks.transport.mock.calls[1]?.[1]).toMatchObject({
      collection: 'posts',
      first: true,
      resolveVariant: { ref: 'posts.hello' }
    })
  })

  test('fails clearly when populate target disagrees with typed relation metadata', async () => {
    await expect(one(createContext(), docs, {
      by: { path: '/docs/guide' },
      populate: { relatedAuthor: posts }
    })).rejects.toThrow(
      'Cannot populate "docs.relatedAuthor" from "posts". Reference metadata declares "docs.relatedAuthor" points to "authors".'
    )

    expect(mocks.transport).not.toHaveBeenCalled()
  })

  test('fails clearly when populate target disagrees with runtime relation metadata', async () => {
    await expect(one(createContext({
        collections: {
          docs: {
            references: {
              authors: ['relatedAuthor']
            }
          }
        }
      }), 'docs', {
      by: { path: '/docs/guide' },
      populate: { relatedAuthor: 'posts' }
    })).rejects.toThrow(
      'Cannot populate "docs.relatedAuthor" from "posts". Reference metadata declares "docs.relatedAuthor" points to "authors".'
    )

    expect(mocks.transport).not.toHaveBeenCalled()
  })

  test('carries locale and fallback through field-keyed i18n populate reads', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'localizedPosts') {
        return {
          result: {
            id: 'content:localized-posts:krypto.md',
            path: '/krypto',
            collection: 'localizedPosts',
            locale: 'de',
            resolved: {
              variantPaths: {
                en: '/crypto',
                de: '/krypto'
              }
            },
            ref: 'posts.krypto',
            title: 'Krypto',
            primaryAuthor: 'authors.emily',
            body: null
          }
        }
      }

      if (params.collection === 'localizedAuthors') {
        return {
          result: {
            id: 'content:localized-authors:emily.md',
            path: '/de/autoren/emily',
            collection: 'localizedAuthors',
            locale: 'de',
            resolved: {
              variantPaths: {
                en: '/emily',
                de: '/emily'
              }
            },
            ref: 'authors.emily',
            title: 'Emily DE',
            name: 'Emily',
            body: null
          }
        }
      }

      return null
    })

    const post = await one(createContext({
        defaultLocale: 'en',
        locales: ['en', 'de'],
        collections: {
          localizedPosts: {
            i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
            route: '/blog',
            localePolicy: {
              localized: true,
              locales: ['en', 'de'],
              defaultLocale: 'en',
              fallback: { de: ['en'] },
              translatedSlugs: false,
              routeMounts: { en: '/blog', de: '/blog' }
            }
          },
          localizedAuthors: {
            i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
            route: { en: '/authors', de: '/autoren' },
            localePolicy: {
              localized: true,
              locales: ['en', 'de'],
              defaultLocale: 'en',
              fallback: { de: ['en'] },
              translatedSlugs: false,
              routeMounts: { en: '/authors', de: '/autoren' }
            }
          }
        }
      }), localizedPosts, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/blog/krypto' },
      populate: { primaryAuthor: localizedAuthors }
    })

    expect(post?.primaryAuthor).toMatchObject({
      title: 'Emily DE',
      route: expect.objectContaining({ resolvedPath: '/de/autoren/emily' }),
      resolution: expect.objectContaining({
        requested: { locale: 'de' },
        resolved: { locale: 'de' },
        usedFallback: false
      })
    })
    expect(mocks.transport.mock.calls[1]?.[1]).toMatchObject({
      collection: 'localizedAuthors',
      first: true,
      resolveLocale: {
        locale: 'de',
        fallback: true
      },
      resolveVariant: {
        ref: 'authors.emily',
        fallback: true
      }
    })
  })

  test('returns pagination metadata from the query envelope', async () => {
    mocks.transport.mockImplementationOnce(async (_endpoint, params) => {
      expect(params).toMatchObject({
        collection: 'posts',
        paging: { mode: 'offset', skip: 2, limit: 2 },
        sort: [{ title: 1 }]
      })
      expect(params).not.toHaveProperty('skip')
      expect(params).not.toHaveProperty('limit')

      return {
        result: [
          {
            id: 'content:posts:two.md',
            path: '/two',
            collection: 'posts',
            title: 'Two',
            authors: [],
            body: null
          },
          {
            id: 'content:posts:three.md',
            path: '/three',
            collection: 'posts',
            title: 'Three',
            authors: [],
            body: null
          }
        ],
        total: 5,
        skip: 2,
        limit: 2
      }
    })

    const page = await paginate({
      runtime: {},
      transport
    }, posts, {
      page: 2,
      limit: 2,
      sort: { title: 'asc' }
    })

    expect(page.data.map(item => item.route.resolvedPath)).toEqual(['/two', '/three'])
    expect(page).toMatchObject({
      mode: 'offset',
      page: 2,
      limit: 2,
      total: 5,
      pageCount: 3,
      hasNext: true,
      hasPrevious: true,
      nextPage: 3,
      previousPage: 1
    })
  })

  test('rejects pagination outside public query limits instead of changing the requested page', async () => {
    await expect(paginate({
      runtime: {},
      transport
    }, posts, {
      page: 200,
      limit: 1_000
    } as never)).rejects.toThrow(/limit exceeds the maximum/)

    await expect(paginate({
      runtime: {},
      transport
    }, posts, {
      page: 102,
      limit: 100
    })).rejects.toThrow(/maximum query skip/)

    expect(mocks.transport).not.toHaveBeenCalled()
  })

  test('rejects contradictory pagination modes before transport', async () => {
    for (const options of [
      { after: 'cursor-without-mode' },
      { mode: 'offset', after: 'cursor' },
      { mode: 'cursor', page: 2 },
      { mode: 'unknown' }
    ]) {
      await expect(paginate({
        runtime: {},
        transport
      }, posts, options as never)).rejects.toThrow(/pagination mode|does not accept/)
    }

    expect(mocks.transport).not.toHaveBeenCalled()
  })

  test('resolves backlinks by inferring reference fields from typed source handles', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'authors') {
        return {
          result: {
            id: 'content:authors:ada.yml',
            path: '/authors/ada',
            canonicalKey: 'authors/ada',
            collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      if (params.collection === 'posts') {
        expect(params.where).toEqual([
          {
            $or: [
              {
                authors: {
                  $in: expect.arrayContaining(['authors.ada', 'authors/ada', '/authors/ada'])
                }
              }
            ]
          }
        ])

        return {
          result: [
            {
              id: 'content:posts:hello.md',
              path: '/hello',
              collection: 'posts',
              title: 'Hello',
              authors: ['authors.ada'],
              body: null
            }
          ],
          skip: 0,
          limit: 100,
          total: 1
        }
      }

      return null
    })

    const result = await backlinks({
      runtime: {},
      transport
    }, authors, {
      by: { ref: 'authors.ada' },
      from: posts
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      title: 'Hello',
      route: expect.objectContaining({ resolvedPath: '/hello' })
    })
  })

  test('resolves backlinks from string sources with explicit fields', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'authors') {
        return {
          result: {
            id: 'content:authors:ada.yml',
            path: '/authors/ada',
            collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      if (params.collection === 'articles') {
        expect(params.where).toEqual([
          {
            $or: [
              {
                author: {
                  $in: expect.arrayContaining(['authors.ada'])
                }
              }
            ]
          }
        ])
        return { result: [], skip: 0, limit: 100, total: 0 }
      }

      return null
    })

    await backlinks({
      runtime: {},
      transport
    }, authors, {
      by: { ref: 'authors.ada' },
      from: 'articles',
      via: ['author']
    })
  })

  test('infers backlinks from string source collection metadata', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'authors') {
        return {
          result: {
            id: 'content:authors:ada.yml',
            path: '/authors/ada',
            collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      if (params.collection === 'posts') {
        expect(params.where).toEqual([
          {
            $or: [
              {
                authors: {
                  $in: expect.arrayContaining(['authors.ada'])
                }
              }
            ]
          }
        ])
        return { result: [], skip: 0, limit: 100, total: 0 }
      }

      return null
    })

    await backlinks({
      runtime: {
        collections: {
          posts: {
            references: {
              authors: ['authors']
            }
          }
        }
      },
      transport
    }, 'authors', {
      by: { ref: 'authors.ada' },
      from: 'posts'
    })

    expect(mocks.transport).toHaveBeenCalledWith('query', expect.objectContaining({
      collection: 'posts'
    }))
  })

  test('fails clearly when backlink fields cannot be inferred or resolved explicitly', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'authors') {
        return {
          result: {
            id: 'content:authors:ada.yml',
            path: '/authors/ada',
            collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      return null
    })

    await expect(backlinks({
      runtime: {},
      transport
    }, 'authors', {
      by: { ref: 'authors.ada' },
      from: 'posts'
    })).rejects.toThrow(
      'Cannot infer backlink fields from "posts" to "authors". Declare fields.relation'
    )
  })

  test('resolves backlinks from multiple sources with per-source fields', async () => {
    const seen = new Map<string, unknown>()
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'authors') {
        return {
          result: {
            id: 'content:authors:ada.yml',
            path: '/authors/ada',
            canonicalKey: 'authors/ada',
            collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      if (params.collection === 'posts' || params.collection === 'docs') {
        seen.set(params.collection, params.where)
        return { result: [], skip: 0, limit: 100, total: 0 }
      }

      return null
    })

    await backlinks({
      runtime: {},
      transport
    }, authors, {
      by: { ref: 'authors.ada' },
      from: [posts, docs],
      via: {
        posts: ['authors'],
        docs: ['relatedAuthor']
      }
    })

    expect(seen.get('posts')).toEqual([
      {
        $or: [
          {
            authors: {
              $in: expect.arrayContaining(['authors.ada'])
            }
          }
        ]
      }
    ])
    expect(seen.get('docs')).toEqual([
      {
        $or: [
          {
            relatedAuthor: {
              $in: expect.arrayContaining(['authors.ada'])
            }
          }
        ]
      }
    ])
  })

  test('does not query backlink sources when the target has no reference identity', async () => {
    mocks.transport.mockResolvedValueOnce({
      result: {
        title: 'Anonymous',
        body: null
      }
    })

    const result = await backlinks({
      runtime: {},
      transport
    }, authors, {
      by: { ref: 'missing-identity' },
      from: posts
    })

    expect(result).toEqual([])
    expect(mocks.transport).toHaveBeenCalledTimes(1)
  })
})
