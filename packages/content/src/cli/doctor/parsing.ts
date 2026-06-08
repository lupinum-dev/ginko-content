interface CollectionDefinition {
  name: string
  block: string
}

interface AuthoredCollectionDefinition {
  key?: string
  block: string
}

export const localeCodePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/

function findMatchingBrace(text: string, start: number): number {
  let depth = 0
  let quote: string | undefined
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = start; index < text.length; index++) {
    const char = text[index]
    const next = text[index + 1]

    if (lineComment) {
      if (char === '\n') {
        lineComment = false
      }
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index++
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      }
      else if (char === '\\') {
        escaped = true
      }
      else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      index++
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      index++
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '{') {
      depth++
    }
    else if (char === '}') {
      depth--
      if (depth === 0) {
        return index
      }
    }
  }

  return text.length - 1
}

function findAuthoredCollectionDefinitions(text: string): Map<string, AuthoredCollectionDefinition> {
  const definitions = new Map<string, AuthoredCollectionDefinition>()
  const callPattern = /\bdefineCollection\s*\(/g

  for (const match of text.matchAll(callPattern)) {
    const callStart = match.index || 0
    const argsStart = callStart + match[0].length
    const args = text.slice(argsStart)
    const objectMatch = args.match(/^\s*\{/)
    if (!objectMatch) {
      continue
    }

    const bodyStart = argsStart + objectMatch[0].lastIndexOf('{')
    const bodyEnd = findMatchingBrace(text, bodyStart)
    const block = text.slice(bodyStart, bodyEnd + 1)
    const prefix = text.slice(0, callStart)
    const propertyMatch = prefix.match(/([a-z_$][\w$]*)\s*:\s*$/i)
    if (propertyMatch) {
      definitions.set(propertyMatch[1], {
        key: propertyMatch[1],
        block
      })
      continue
    }

    const variableMatch = prefix.match(/(?:^|[\s;])(?:export\s+)?(?:const|let|var)\s+([a-z_$][\w$]*)\s*=\s*$/i)
    if (variableMatch) {
      definitions.set(variableMatch[1], { block })
    }
  }

  return definitions
}

export function findCollectionDefinitions(text: string): CollectionDefinition[] {
  const authoredCollections = findAuthoredCollectionDefinitions(text)
  const definitions = new Map<string, CollectionDefinition>()

  for (const block of findObjectPropertyBlocks(text, 'collections')) {
    for (const match of block.matchAll(/([a-z_$][\w$]*)\s*:\s*([a-z_$][\w$]*)\b/g)) {
      const [, key, identifier] = match
      const authored = authoredCollections.get(identifier)
      if (authored) {
        definitions.set(key, {
          name: key,
          block: authored.block
        })
      }
    }

    for (const match of block.matchAll(/(?:^|[,{]\s*)([a-z_$][\w$]*)\s*(?=,|\})/g)) {
      const key = match[1]
      const authored = authoredCollections.get(key)
      if (authored) {
        definitions.set(key, {
          name: key,
          block: authored.block
        })
      }
    }
  }

  for (const authored of authoredCollections.values()) {
    if (authored.key) {
      definitions.set(authored.key, {
        name: authored.key,
        block: authored.block
      })
    }
  }

  return [...definitions.values()]
}

export function findObjectPropertyBlocks(text: string, property: string): string[] {
  const blocks: string[] = []
  const pattern = new RegExp(`\\b${property}\\s*:\\s*\\{`, 'g')

  for (const match of text.matchAll(pattern)) {
    const bodyStart = text.indexOf('{', match.index)
    if (bodyStart === -1) {
      continue
    }

    const bodyEnd = findMatchingBrace(text, bodyStart)
    blocks.push(text.slice(bodyStart, bodyEnd + 1))
  }

  return blocks
}

export function extractStringArrayProperty(block: string, property: string): string[] {
  const match = block.match(new RegExp(`\\b${property}\\s*:\\s*\\[([\\s\\S]*?)\\]`))
  if (!match) {
    return []
  }

  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item => item[1])
}

export function extractLocaleCodesFromConfig(text: string): string[] {
  const locales = new Set<string>()

  for (const match of text.matchAll(/\bcode\s*:\s*['"]([^'"]+)['"]/g)) {
    if (localeCodePattern.test(match[1])) {
      locales.add(match[1])
    }
  }

  for (const match of text.matchAll(/\bdefaultLocale\s*:\s*['"]([^'"]+)['"]/g)) {
    if (localeCodePattern.test(match[1])) {
      locales.add(match[1])
    }
  }

  for (const match of text.matchAll(/\blocales\s*:\s*\[([\s\S]*?)\]/g)) {
    if (/\bcode\s*:/.test(match[1])) {
      continue
    }

    for (const localeMatch of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      if (localeCodePattern.test(localeMatch[1])) {
        locales.add(localeMatch[1])
      }
    }
  }

  return [...locales]
}
