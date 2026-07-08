import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withLeadingSlash } from 'ufo'
import { one } from '@lupinum/ginko-content/server'

export default eventHandler(async (event) => {
  const slug = getRouterParams(event)['slug.md']
  if (!slug?.endsWith('.md')) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
  }

  const path = withLeadingSlash(slug.replace('.md', ''))

  const page = await one(event, 'docs' as any, { by: { path } } as any) as { file?: { path?: string } } | null
  if (!page?.file?.path) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
  }

  const source = await readFile(join(process.cwd(), 'content', page.file.path), 'utf8')

  setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  return source
})
