import { load } from 'js-yaml'
import type { ParsedContent } from '../types/content'
import { defineTransformer } from './utils'
import { stripReservedContentKeys } from './reserved'

export default defineTransformer({
  name: 'Yaml',
  extensions: ['.yml', '.yaml'],
  parse: (id, content) => {
    const data = load(String(content)) as ParsedContent | ParsedContent[]

    // Keep array contents under `body` key
    let parsed = data
    if (Array.isArray(data)) {
      console.warn(`YAML array is not supported in ${id}, moving the array into the \`body\` key`)
      parsed = { body: data } as unknown as ParsedContent
    }

    parsed = stripReservedContentKeys(parsed as Record<string, unknown>, id) as ParsedContent

    return <ParsedContent> {
      ...parsed,
      id,
      type: 'yaml'
    }
  }
})
