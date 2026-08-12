import { many, one, paginate } from '@lupinum/ginko-content/server'
      import { pages } from '../../content.config'

      export default defineEventHandler(async (event) => ({
        found: await one(event, pages, { by: { path: '/' } }),
        missing: await one(event, pages, { by: { path: '/missing' } }),
        list: await many(event, pages, { limit: 2 }),
        cursorFirst: await paginate(event, pages, { mode: 'cursor', after: null, limit: 1 }),
        cursorSecond: await paginate(event, pages, { mode: 'cursor', after: 'page-2', limit: 1 })
      }))
    
