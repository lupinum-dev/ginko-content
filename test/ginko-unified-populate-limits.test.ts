import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineCollection, defineContentConfig, reference } from '../packages/content/src/types/config'
import { many, one } from '../packages/content/src/features/query/unified'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  transport: vi.fn()
}))

const contentConfig = defineContentConfig({
  collections: {
    authors: defineCollection({
      type: 'data',
      source: 'authors/*.yml',
      schema: z.object({ name: z.string() })
    }),
    posts: defineCollection({
      type: 'page',
      source: 'posts/*.md',
      schema: z.object({
        title: z.string(),
        authors: z.array(reference('authors'))
      })
    })
  }
})

const { authors, posts } = contentConfig.collections

describe('unified query populate limits and concurrency', () => {
  beforeEach(() => {
    mocks.transport.mockReset()
  })

  test('deduplicates repeated reference reads across one result set', async () => {
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'posts') {
        return {
          result: [
            {
              id: 'content:posts:first.md',
              path: '/first',
              collection: 'posts',
              title: 'First',
              authors: ['authors.ada'],
              body: null
            },
            {
              id: 'content:posts:second.md',
              path: '/second',
              collection: 'posts',
              title: 'Second',
              authors: ['authors.ada'],
              body: null
            }
          ],
          skip: 0,
          limit: 100,
          total: 2
        }
      }

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
    })

    const result = await many({
      runtime: {},
      transport: mocks.transport
    }, posts, {
      populate: { authors }
    })

    expect(result).toHaveLength(2)
    expect(result.every(post => post.authors[0]?.name === 'Ada')).toBe(true)
    expect(mocks.transport).toHaveBeenCalledTimes(2)
  })

  test('bounds concurrent population reads', async () => {
    const refs = Array.from({ length: 20 }, (_, index) => `authors.${index}`)
    let active = 0
    let maximumActive = 0
    mocks.transport.mockImplementation(async (_endpoint, params) => {
      if (params.collection === 'posts') {
        return {
          result: {
            id: 'content:posts:hello.md',
            path: '/hello',
            collection: 'posts',
            title: 'Hello',
            authors: refs,
            body: null
          }
        }
      }

      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active -= 1
      return {
        result: {
          id: `content:authors:${params.resolveVariant.ref}.yml`,
          path: `/authors/${params.resolveVariant.ref}`,
          collection: 'authors',
          ref: params.resolveVariant.ref,
          name: params.resolveVariant.ref,
          body: null
        }
      }
    })

    const result = await one({
      runtime: {},
      transport: mocks.transport
    }, posts, {
      by: { path: '/hello' },
      populate: { authors }
    })

    expect(result?.authors).toHaveLength(20)
    expect(maximumActive).toBe(8)
  })

  test('rejects excessive population before starting reference reads', async () => {
    mocks.transport.mockResolvedValueOnce({
      result: {
        id: 'content:posts:hello.md',
        path: '/hello',
        collection: 'posts',
        title: 'Hello',
        authors: Array.from({ length: 1_001 }, (_, index) => `authors.${index}`),
        body: null
      }
    })

    await expect(one({
      runtime: {},
      transport: mocks.transport
    }, posts, {
      by: { path: '/hello' },
      populate: { authors }
    })).rejects.toThrow('Content population exceeds the maximum of 1000 references per result set.')

    expect(mocks.transport).toHaveBeenCalledTimes(1)
  })
})
