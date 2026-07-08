import type { MarkdownNode, ParsedContent } from '../../types/content'
import type { ContentCollectionSearchSectionsOptions, ContentSearchSection } from '../../types/query'

const HEADING = /^h([1-6])$/

const headingLevel = (tag: string) => Number(tag.match(HEADING)?.[1] ?? 0)

type SearchablePage = Pick<ParsedContent, 'path' | 'title' | 'description' | 'body'> & Record<string, unknown>

/**
 * Backing option type for search-section generation.
 *
 * Re-exported through the public query surface as
 * `ContentCollectionSearchSectionsOptions`.
 */
export type GenerateSearchSectionsOptions = ContentCollectionSearchSectionsOptions

/**
 * Searchable content section emitted for one page heading range.
 *
 * Re-exported through the public query surface as `ContentSearchSection`.
 */
export type SearchSection = ContentSearchSection

/**
 * Split pages into searchable sections for pagefind-like indexing.
 */
export function createSearchSections (
  pages: SearchablePage[],
  opts?: GenerateSearchSectionsOptions
): SearchSection[] {
  const { ignoredTags = ['pre', 'style', 'script'], extraFields = [], minHeading = 'h1', maxHeading = 'h6' } = opts || {}
  const minLevel = headingLevel(minHeading)
  const maxLevel = headingLevel(maxHeading)

  return pages.flatMap(page =>
    splitPageIntoSections(page, {
      ignoredTags,
      extraFields,
      minLevel,
      maxLevel
    })
  )
}

function splitPageIntoSections (
  page: SearchablePage,
  {
    ignoredTags,
    extraFields,
    minLevel,
    maxLevel
  }: {
    ignoredTags: string[]
    extraFields: string[]
    minLevel: number
    maxLevel: number
  }
) {
  const path = page.path || ''
  const extraFieldsData = pick(extraFields, page)
  const body = page.body

  const sections: SearchSection[] = [{
    ...extraFieldsData,
    id: path,
    title: normalizeSearchText(String(page.title || '')),
    titles: [],
    content: normalizeSearchText(String(page.description || '')),
    level: 1
  }]

  if (!body?.children) {
    return sections
  }

  let section = 1
  let previousHeadingLevel = 0
  const titles = [normalizeSearchText(String(page.title || ''))]

  for (const item of body.children) {
    const tag = item.tag || ''
    const level = headingLevel(tag)

    if (level >= minLevel && level <= maxLevel) {
      const title = extractTextFromAst(item).trim()

      if (level === 1) {
        titles.splice(0, titles.length)
      } else if (level < previousHeadingLevel) {
        titles.splice(level - 1, titles.length - 1)
      } else if (level === previousHeadingLevel) {
        titles.pop()
      }

      sections.push({
        ...extraFieldsData,
        id: `${path}#${item.props?.id || ''}`,
        title,
        titles: [...titles],
        content: '',
        level
      })

      titles.push(title)
      previousHeadingLevel = level
      section += 1
    } else {
      const content = normalizeSearchText(extractTextFromAst(item, ignoredTags))

      if (section === 1 && sections[section - 1]?.content === content) {
        continue
      }

      sections[section - 1]!.content = `${sections[section - 1]!.content} ${content}`.trim()
    }
  }

  return sections
}

function extractTextFromAst (node: MarkdownNode, ignoredTags: string[] = []) {
  let text = ''

  if (node.type === 'text') {
    text += node.value || ''
  }

  if (ignoredTags.includes(node.tag || '')) {
    return ''
  }

  if (node.children?.length) {
    text += node.children
      .map(child => extractTextFromAst(child, ignoredTags))
      .filter(Boolean)
      .join('')
  }

  return text
}

function normalizeSearchText (value: string) {
  return value
    .replace(/\[([^\]]+)\x5D\x7B[^\x7D]+\x7D/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function pick (fields: string[], page: Record<string, unknown>) {
  if (!fields.length) {
    return {}
  }

  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (typeof page[field] !== 'undefined') {
      result[field] = page[field]
    }
    return result
  }, {})
}
