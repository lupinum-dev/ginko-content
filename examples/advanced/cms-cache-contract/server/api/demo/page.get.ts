import { one } from '#content/server'
import { createError, defineEventHandler, getQuery } from 'h3'
import { blog } from '../../../content.config'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const path = typeof query.path === 'string' ? query.path : '/blog/post-1'
  const page = await one(event, blog, {
    by: { path }
  })

  if (!page) {
    throw createError({
      statusCode: 404,
      statusMessage: 'page_not_found'
    })
  }

  return page
})
