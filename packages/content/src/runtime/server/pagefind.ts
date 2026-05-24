import type { ContentSearchIndexRecord } from '../../types/search'

export async function writePagefindIndex (records: ContentSearchIndexRecord[], outputPath: string) {
  const { createIndex } = await import('pagefind')
  const { index } = await createIndex()
  if (!index) {
    throw new Error('Failed to initialize Pagefind index')
  }

  for (const record of records) {
    const url = record.anchor ? `${record.path}#${record.anchor}` : record.path
    const content = [record.title, ...record.headings, record.content].filter(Boolean).join('\n')
    const response = await index.addCustomRecord({
      url,
      content,
      language: record.locale || 'en',
      meta: {
        title: record.title,
        excerpt: record.excerpt,
        locale: record.locale || '',
        anchor: record.anchor || '',
        path: record.path
      }
    })

    if (response.errors.length) {
      throw new Error(`Failed to add Pagefind record for ${url}: ${response.errors.join(', ')}`)
    }
  }

  const response = await index.writeFiles({ outputPath })
  if (response.errors.length) {
    throw new Error(`Failed to write Pagefind index: ${response.errors.join(', ')}`)
  }
}
