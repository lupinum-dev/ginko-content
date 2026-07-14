const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sourceMatch = (content: string, term: string) => {
  if (!term) return
  const match = new RegExp(escapeRegExp(term), 'iu').exec(content)
  if (match?.index !== undefined) return { index: match.index, length: match[0].length }
}

const findMatch = (content: string, term: string) => {
  const normalizedTerm = collapseWhitespace(term)
  const exactMatch = sourceMatch(content, normalizedTerm)
  if (exactMatch) return exactMatch

  const tokens = normalizedTerm
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(token => token.length > 1)
    .sort((left, right) => right.length - left.length)
  for (const token of tokens) {
    const match = sourceMatch(content, token)
    if (match) return match
  }
}

const moveToWordBoundary = (content: string, index: number, direction: -1 | 1) => {
  let cursor = index
  while (cursor > 0 && cursor < content.length && !/\s/u.test(content[cursor] || '')) {
    cursor += direction
  }
  return cursor
}

/**
 * Return a plain-text excerpt centred on the first useful query match.
 * Highlighting stays consumer-owned so every search backend exposes the same
 * safe result shape.
 */
export const createSearchExcerpt = (
  content: string,
  term: string,
  fallback = '',
  maxLength = 240
) => {
  const normalizedContent = collapseWhitespace(content)
  const normalizedFallback = collapseWhitespace(fallback)
  const length = Math.max(40, Math.floor(maxLength))
  const match = findMatch(normalizedContent, term)

  if (!normalizedContent || !match) return normalizedFallback.slice(0, length)
  if (normalizedContent.length <= length) return normalizedContent

  const idealStart = Math.max(0, match.index - Math.floor((length - match.length) / 2))
  const wordStart = idealStart > 0 ? moveToWordBoundary(normalizedContent, idealStart, 1) : 0
  const start = wordStart > match.index ? idealStart : wordStart
  const idealEnd = Math.min(normalizedContent.length, start + length)
  const wordEnd = idealEnd < normalizedContent.length ? moveToWordBoundary(normalizedContent, idealEnd, -1) : normalizedContent.length
  const end = wordEnd < match.index + match.length ? idealEnd : wordEnd
  let excerptStart = start
  let excerptEnd = Math.max(end, match.index + match.length)
  const prefix = excerptStart > 0 ? '…' : ''
  const suffix = excerptEnd < normalizedContent.length ? '…' : ''
  const available = length - prefix.length - suffix.length
  const overflow = Math.max(0, excerptEnd - excerptStart - available)
  if (overflow) {
    const removableAfterMatch = Math.max(0, excerptEnd - (match.index + match.length))
    const trimEnd = Math.min(overflow, removableAfterMatch)
    excerptEnd -= trimEnd
    excerptStart += overflow - trimEnd
  }
  const excerpt = normalizedContent.slice(excerptStart, excerptEnd).trim()

  return `${prefix}${excerpt}${suffix}`
}
