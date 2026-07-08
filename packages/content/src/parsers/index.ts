import { extname } from 'pathe'
import { camelCase } from 'scule'
import type { StorageValue } from 'unstorage'
import type { ContentTransformer, ParsedContent, TransformContentOptions } from '../types/content'
import csv from './csv.js'
import markdown from './markdown.js'
import yaml from './yaml.js'
import pathMeta from './path-meta.js'
import json from './json.js'

const TRANSFORMERS = [
  csv,
  markdown,
  json,
  yaml,
  pathMeta
]

function getParser (ext: string, additionalTransformers: ContentTransformer[] = []): ContentTransformer | undefined {
  let parser = additionalTransformers.find(p => ext.match(new RegExp(p.extensions.join('|'), 'i')) && p.parse)
  if (!parser) {
    parser = TRANSFORMERS.find(p => ext.match(new RegExp(p.extensions.join('|'), 'i')) && p.parse)
  }

  return parser
}

function getTransformers (ext: string, additionalTransformers: ContentTransformer[] = []) {
  return [
    ...additionalTransformers.filter(p => ext.match(new RegExp(p.extensions.join('|'), 'i')) && p.transform),
    ...TRANSFORMERS.filter(p => ext.match(new RegExp(p.extensions.join('|'), 'i')) && p.transform)
  ]
}

/**
 * Parse content file using registered plugins
 */
export async function transformContent (id: string, content: StorageValue, options: TransformContentOptions = {}): Promise<ParsedContent> {
  const { transformers = [] } = options
  // Call hook before parsing the file
  const file = { id: id, body: content }

  const ext = extname(id)
  const parser = getParser(ext, transformers)
  if (!parser) {
     
    console.warn(`${ext} files are not supported, "${id}" storing body as null`)
    return { id: file.id, body: null, missing: true } as ParsedContent
  }

  const parserOptions = options[camelCase(parser.name)] || {}
  const parsed = await parser.parse!(file.id, file.body, parserOptions)

  const matchedTransformers = getTransformers(ext, transformers)
  const result = await matchedTransformers.reduce(async (prev, cur) => {
    const next = (await prev) || parsed

    const transformOptions = options[camelCase(cur.name)]

    // disable transformer if options is false
    if (transformOptions === false) {
      return next
    }

    return cur.transform!(next, transformOptions || {})
  }, Promise.resolve(parsed))

  return result
}

export { defineTransformer } from './utils'
