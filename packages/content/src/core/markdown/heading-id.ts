/**
 * Document-owned heading ids and legacy fragments. Parsing, projections and
 * rendering share this allocator; Comark automatic heading ids are disabled.
 */

// Inline HTML tags contribute only their text. Other element tags are inline
// components and contribute their name.
const HTML_INLINE_TAGS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i',
  'img', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
])

/**
 * Keep Unicode letters, marks and numbers in a normalized, nonempty slug.
 * A leading ASCII digit retains the historical `_` prefix.
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '')
    .replace(/-{2,}/g, '-')
  const trimmed = trimHyphens(slug) || 'heading'
  return /^\d/.test(trimmed) ? `_${trimmed}` : trimmed
}

/** Remove leading and trailing hyphens in linear time. */
function trimHyphens(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === '-') start += 1
  while (end > start && value[end - 1] === '-') end -= 1
  return value.slice(start, end)
}

/**
 * Collect the text the parser slugs for a heading from its child tuples.
 * Inline components add their tag name; `br` and inline HTML comments add
 * nothing.
 */
export function headingSlugText(children: readonly unknown[]): string {
  let text = ''
  for (const child of children) {
    if (typeof child === 'string') {
      text += child
      continue
    }
    if (!Array.isArray(child)) continue
    const tag = child[0]
    if (tag === 'br' || tag === 'html_inline') continue
    if (typeof tag === 'string' && !HTML_INLINE_TAGS.has(tag)) text += ` ${tag} `
    if (child.length > 2) text += headingSlugText(child.slice(2))
  }
  return text
}

/** Native HTML and same-named components keep their authored attributes. */
export function markdownHeadingLevel(tag: string, props: Record<string, unknown>): number | undefined {
  const origin = props.$
  if (origin && typeof origin === 'object' && ('html' in origin || 'syntax' in origin)) return undefined
  const match = /^h([1-6])$/.exec(tag)
  return match ? Number(match[1]) : undefined
}

/** Assigns heading ids in document order. */
export type HeadingIdGenerator = (text: string, level: number) => string

/**
 * Streaming Unicode sequence for callers without a complete document. Use
 * resolveHeadingAnchors when explicit ids and legacy fragment reservations
 * must participate in document-wide collision handling.
 */
export function createHeadingIdGenerator(): HeadingIdGenerator {
  const stack: Array<{ level: number, id: string }> = []
  const used = new Set<string>()
  return (text, level) => {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
    const parent = stack[stack.length - 1]
    const slug = `${parent && parent.level >= 2 ? `${parent.id}-` : ''}${slugifyHeading(text)}`
    let id = slug
    let suffix = 0
    while (used.has(id)) id = `${slug}-${++suffix}`
    used.add(id)
    stack.push({ level, id })
    return id
  }
}

export interface HeadingDescriptor {
  text: string
  level: number
  /** An authored or persisted id. It remains authoritative. */
  id?: string
}

export interface HeadingAnchor {
  id: string
  aliases: string[]
}

/** Exact pre-Unicode sequence, including its empty and duplicate id behavior. */
function legacyHeadingIds(headings: readonly HeadingDescriptor[]): string[] {
  const stack: Array<{ level: number, id: string }> = []
  const counts = new Map<string, number>()
  return headings.map(({ text, level }) => {
    let slug = trimHyphens(text.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/-{2,}/g, '-'))
    if (/^\d/.test(slug)) slug = `_${slug}`
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent && parent.level >= 2) slug = `${parent.id}-${slug}`
    stack.push({ level, id: slug })
    const count = counts.get(slug) ?? 0
    counts.set(slug, count + 1)
    return count === 0 ? slug : `${slug}-${count}`
  })
}

/**
 * Allocate one ordered document. Reserve old fragments before new ids so an
 * old link cannot land on another heading after the Unicode cutover. If old
 * ids collided, their first target wins, as browser fragment lookup did.
 * Explicit/persisted ids and other authored element ids always take priority.
 * This derives aliases without adding metadata to stored V1/V2 documents.
 */
export function resolveHeadingAnchors(
  headings: readonly HeadingDescriptor[],
  occupiedIds: readonly string[] = [],
): HeadingAnchor[] {
  const legacy = legacyHeadingIds(headings)
  const legacyOwner = new Map<string, number>()
  legacy.forEach((id, index) => { if (id && !legacyOwner.has(id)) legacyOwner.set(id, index) })
  const reserved = new Set([...occupiedIds, ...headings.flatMap(heading => heading.id === undefined ? [] : [heading.id])])
  const used = new Set<string>()
  const allocated = new Set<string>()
  const stack: Array<{ level: number, id: string }> = []
  const anchors = headings.map(({ text, level, id: authored }, index): HeadingAnchor => {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
    const parent = stack[stack.length - 1]
    const slug = `${parent && parent.level >= 2 ? `${parent.id}-` : ''}${slugifyHeading(text)}`
    let generated = slug
    let suffix = 0
    while (allocated.has(generated) || (reserved.has(generated) && generated !== authored) || (legacyOwner.has(generated) && legacyOwner.get(generated) !== index)) generated = `${slug}-${++suffix}`
    allocated.add(generated)
    const id = authored ?? generated
    used.add(id)
    // An explicit anchor does not rename the generated child prefix.
    stack.push({ level, id: generated })
    return { id, aliases: [] }
  })
  anchors.forEach((anchor, index) => {
    const old = legacy[index]!
    if (old && old !== anchor.id && legacyOwner.get(old) === index && !used.has(old) && !reserved.has(old)) {
      anchor.aliases.push(old)
      used.add(old)
    }
  })
  return anchors
}
