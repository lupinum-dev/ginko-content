import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineCollection, reference } from '../packages/content/src/types/config'
import { backlinks, one, paginate } from '../packages/content/src/runtime/query/unified'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  transport: vi.fn()
}))

const authors = defineCollection('authors', {
  type: 'data',
  source: 'authors/*.yml',
  schema: z.object({
    name: z.string()
  })
})

const posts = defineCollection('posts', {
  type: 'page',
  source: 'posts/*.md',
  schema: z.object({
    title: z.string(),
    authors: z.array(reference('authors'))
  })
})

const docs = defineCollection('docs', {
  type: 'page',
  source: 'docs/*.md',
  schema: z.object({
    title: z.string(),
    relatedAuthor: reference('authors').optional()
  })
})

describe('unified query populate', () => {
  beforeEach(() => {
    mocks.transport.mockReset()
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'posts') {
        return {
          result: {
            _id: 'content:posts:hello.md',
            _path: '/hello',
            _collection: 'posts',
            title: 'Hello',
            authors: ['authors.ada'],
            body: null
          }
        }
      }

      if (params.collection === 'authors') {
        return {
          result: {
            _id: 'content:authors:ada.yml',
            _path: '/authors/ada',
            _collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      return { result: null }
    })
  })

  test('resolves explicit reference fields through target collection handles', async () => {
    const context = {
      runtime: {},
      transport: mocks.transport
    }
    const post = await one(context, posts, {
      by: { path: '/hello' },
      select: ['title'],
      populate: { authors }
    })

    expect(post?.authors).toEqual([
      expect.objectContaining({
        name: 'Ada',
        path: '/authors/ada',
        resolved: expect.objectContaining({
          fallback: false
        })
      })
    ])

    expect(mocks.transport).toHaveBeenCalledTimes(2)
    expect(mocks.transport.mock.calls[0]?.[1]).toMatchObject({
      collection: 'posts',
      first: true,
      only: expect.arrayContaining(['title', 'authors', '_path', '_file', '_canonicalKey', '_locale'])
    })
    expect(mocks.transport.mock.calls[1]?.[1]).toMatchObject({
      collection: 'authors',
      first: true,
      resolveVariant: { ref: 'authors.ada' }
    })
  })

  test('returns pagination metadata from the query envelope', async () => {
    mocks.transport.mockImplementationOnce(async (_endpoint, params) => {
      expect(params).toMatchObject({
        collection: 'posts',
        skip: 2,
        limit: 2,
        sort: [{ title: 1 }]
      })

      return {
        result: [
          {
            _id: 'content:posts:two.md',
            _path: '/two',
            _collection: 'posts',
            title: 'Two',
            authors: [],
            body: null
          },
          {
            _id: 'content:posts:three.md',
            _path: '/three',
            _collection: 'posts',
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
      transport: mocks.transport
    }, posts, {
      page: 2,
      limit: 2,
      sort: { title: 'asc' }
    })

    expect(page.data.map(item => item.path)).toEqual(['/two', '/three'])
    expect(page).toMatchObject({
      page: 2,
      limit: 2,
      total: 5,
      pageCount: 3,
      hasNext: true,
      hasPrev: true,
      nextPage: 3,
      prevPage: 1
    })
  })

  test('counts total matches when the provider returns an array instead of an envelope', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.count) {
        expect(params).toMatchObject({
          collection: 'posts',
          count: true
        })
        expect(params).not.toHaveProperty('limit')
        expect(params).not.toHaveProperty('skip')
        return 5
      }

      expect(params).toMatchObject({
        collection: 'posts',
        skip: 2,
        limit: 2
      })
      return [
        {
          _id: 'content:posts:two.md',
          _path: '/two',
          _collection: 'posts',
          title: 'Two',
          authors: [],
          body: null
        },
        {
          _id: 'content:posts:three.md',
          _path: '/three',
          _collection: 'posts',
          title: 'Three',
          authors: [],
          body: null
        }
      ]
    })

    const page = await paginate({
      runtime: {},
      transport: mocks.transport
    }, posts, {
      page: 2,
      limit: 2
    })

    expect(page).toMatchObject({
      total: 5,
      pageCount: 3,
      hasNext: true,
      nextPage: 3
    })
    expect(mocks.transport).toHaveBeenCalledTimes(2)
  })

  test('clamps pagination requests to public query limits before computing metadata', async () => {
    mocks.transport.mockImplementationOnce(async (_endpoint, params) => {
      expect(params).toMatchObject({
        collection: 'posts',
        skip: 10_000,
        limit: 100
      })

      return {
        result: [],
        total: 20_000,
        skip: 10_000,
        limit: 100
      }
    })

    const page = await paginate({
      runtime: {},
      transport: mocks.transport
    }, posts, {
      page: 200,
      limit: 1_000
    })

    expect(page).toMatchObject({
      page: 101,
      limit: 100,
      total: 20_000,
      pageCount: 200,
      hasNext: true,
      hasPrev: true,
      nextPage: 102,
      prevPage: 100
    })
  })

  test('resolves backlinks by inferring reference fields from typed source handles', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'authors') {
        return {
          result: {
            _id: 'content:authors:ada.yml',
            _path: '/authors/ada',
            _canonicalKey: 'authors/ada',
            _collection: 'authors',
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
              _id: 'content:posts:hello.md',
              _path: '/hello',
              _collection: 'posts',
              title: 'Hello',
              authors: ['authors.ada'],
              body: null
            }
          ],
          total: 1
        }
      }

      return { result: null }
    })

    const result = await backlinks({
      runtime: {},
      transport: mocks.transport
    }, authors, {
      by: { ref: 'authors.ada' },
      from: posts
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      title: 'Hello',
      path: '/hello'
    })
  })

  test('resolves backlinks from string sources with explicit fields', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'authors') {
        return {
          result: {
            _id: 'content:authors:ada.yml',
            _path: '/authors/ada',
            _collection: 'authors',
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
        return { result: [] }
      }

      return { result: null }
    })

    await backlinks({
      runtime: {},
      transport: mocks.transport
    }, authors, {
      by: { ref: 'authors.ada' },
      from: 'articles',
      fields: ['author']
    })
  })

  test('resolves backlinks from multiple sources with per-source fields', async () => {
    const seen = new Map<string, unknown>()
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'authors') {
        return {
          result: {
            _id: 'content:authors:ada.yml',
            _path: '/authors/ada',
            _canonicalKey: 'authors/ada',
            _collection: 'authors',
            ref: 'authors.ada',
            name: 'Ada',
            body: null
          }
        }
      }

      if (params.collection === 'posts' || params.collection === 'docs') {
        seen.set(params.collection, params.where)
        return { result: [] }
      }

      return { result: null }
    })

    await backlinks({
      runtime: {},
      transport: mocks.transport
    }, authors, {
      by: { ref: 'authors.ada' },
      from: [posts, docs],
      fields: {
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
      transport: mocks.transport
    }, authors, {
      by: { ref: 'missing-identity' },
      from: posts
    })

    expect(result).toEqual([])
    expect(mocks.transport).toHaveBeenCalledTimes(1)
  })
})
