import type { ContentSearchIndexRecord } from '../../types/search'
import type { ContentSearchSection } from '../../types/query'

type SearchSectionRecord = ContentSearchSection & { locale?: string, collection?: string, [field: string]: unknown }

export const toSearchIndexRecord = (section: SearchSectionRecord): ContentSearchIndexRecord => {
  const [path = '', anchor = ''] = section.id.split('#')
  const extraFields = Object.fromEntries(
    Object.entries(section).filter(([key]) => !['id', 'title', 'titles', 'content', 'level'].includes(key))
  )
  return {
    ...extraFields,
    id: section.id,
    collection: section.collection || '',
    path,
    title: section.title,
    excerpt: section.content.slice(0, 240),
    content: section.content,
    headings: section.titles,
    anchor: anchor || undefined,
    locale: typeof section.locale === 'string' ? section.locale : undefined
  }
}
