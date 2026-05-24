import type { ContentCacheInvalidateInput } from '#content/server'

export interface DemoAuthor {
  id: string
  name: string
  updatedAt: Date
}

export interface DemoPost {
  id: string
  path: string
  title: string
  author: string
  updatedAt: Date
}

export const authors = new Map<string, DemoAuthor>([
  ['alice', { id: 'alice', name: 'Alice', updatedAt: new Date('2026-01-01T00:00:00Z') }],
  ['bob', { id: 'bob', name: 'Bob', updatedAt: new Date('2026-01-01T00:00:00Z') }]
])

export const posts = new Map<string, DemoPost>([
  ...Array.from({ length: 5 }, (_, index): [string, DemoPost] => {
    const id = `post-${index + 1}`
    return [id, {
      id,
      path: `/blog/${id}`,
      title: `Post ${index + 1}`,
      author: 'alice',
      updatedAt: new Date('2026-01-01T00:00:00Z')
    }]
  }),
  ['post-6', {
    id: 'post-6',
    path: '/blog/post-6',
    title: 'Post 6',
    author: 'bob',
    updatedAt: new Date('2026-01-01T00:00:00Z')
  }]
])

export const providerCacheEvents: Array<ContentCacheInvalidateInput & { source: 'provider' }> = []
export const adapterCacheEvents: Array<ContentCacheInvalidateInput & { source: 'adapter' }> = []

export const postByPath = (path: string) =>
  Array.from(posts.values()).find(post => post.path === path)

export const postsByAuthor = (author: string) =>
  Array.from(posts.values()).filter(post => post.author === author)

export const publishAuthorName = (author: string, name: string) => {
  const entry = authors.get(author)
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'author_not_found'
    })
  }

  entry.name = name
  entry.updatedAt = new Date()

  return {
    tags: [
      `entry:authors:${author}`,
      'collection:authors',
      'collection:blog',
      'search:en',
      'sitemap'
    ],
    paths: [
      `/authors/${author}`,
      '/blog',
      ...postsByAuthor(author).map(post => post.path)
    ]
  } satisfies ContentCacheInvalidateInput
}
