import { parse as parseMarkdown } from 'comark'
import { destr } from 'destr'
import { load as parseYaml } from 'js-yaml'

import { buildContentGraph, type ContentGraph } from '../core/content/graph.js'
import { resolveCollection } from '../core/content/collection.js'
import { transformContent } from '../parsers/index.js'
import type { ParsedContent } from '../types/content.js'
import type { ContentCollectionConfig } from '../types/config.js'
import type { ContentContext } from '../types/module.js'

export type CmsImportContentContext = Pick<
  ContentContext,
  'locales' | 'defaultLocale' | 'translatedSlugs' | 'respectPathCase' | 'markdown' | 'yaml' | 'csv'
> & {
  collections: Record<string, ContentCollectionConfig>
}

export type CmsImportParsedFile = {
  frontmatter: Record<string, unknown>
  body?: string
  document: ParsedContent
}

export async function parseCmsImportFile(args: {
  id: string
  source: string
  context: CmsImportContentContext
}): Promise<CmsImportParsedFile> {
  const document = await transformContent(args.id, args.source, {
    markdown: args.context.markdown,
    yaml: args.context.yaml,
    csv: args.context.csv,
    pathMeta: {
      locales: args.context.locales,
      defaultLocale: args.context.defaultLocale,
      translatedSlugs: args.context.translatedSlugs,
      respectPathCase: args.context.respectPathCase,
      collections: args.context.collections,
      collectionResolver: (filePath: string) =>
        resolveCollection(filePath, args.context.collections, args.context.locales || []),
    },
  })

  const editable = await extractEditableSource(args.id, args.source)
  return {
    ...editable,
    document,
  }
}

export function buildCmsImportGraph(
  documents: ParsedContent[],
  options: {
    locales?: string[]
    defaultLocale?: string
  } = {},
): ContentGraph {
  return buildContentGraph(documents, options)
}

async function extractEditableSource(
  id: string,
  source: string,
): Promise<Omit<CmsImportParsedFile, 'document'>> {
  if (/\.(md|mdc|markdown)$/i.test(id)) {
    return parseMarkdownEditableSource(source)
  }
  if (/\.json5?$/i.test(id)) {
    return { frontmatter: normalizeRecord(destr(source)) }
  }
  if (/\.ya?ml$/i.test(id)) {
    return { frontmatter: normalizeRecord(parseYaml(source)) }
  }
  return { frontmatter: {} }
}

async function parseMarkdownEditableSource(source: string) {
  const tree = await parseMarkdown(source)
  return {
    frontmatter: normalizeRecord(tree.frontmatter),
    body: stripFrontmatter(source).trim(),
  }
}

function stripFrontmatter(source: string) {
  if (!source.startsWith('---')) return source
  const end = source.indexOf('\n---', 3)
  if (end === -1) return source
  return source.slice(source.indexOf('\n', end + 4) + 1)
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
