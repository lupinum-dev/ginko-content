/**
 * Heading ids as the MDC parser assigns them. Keep this module aligned with
 * Comark's token processor: the round-trip tests fail if the two disagree.
 */

// Inline HTML tags contribute only their text. Other element tags are inline
// components and contribute their name.
const HTML_INLINE_TAGS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i',
  'img', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
])

/**
 * Convert heading text to the parser's base slug. Characters outside
 * `[A-Za-z0-9_-]` are removed, and a leading digit gets an `_` prefix.
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^\d/.test(slug) ? `_${slug}` : slug
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

/** Assigns heading ids in document order. */
export type HeadingIdGenerator = (text: string, level: number) => string

/**
 * Create the parser's document-scoped heading id sequence. Call it once for
 * every heading in document order, including headings with an explicit id.
 * A heading at level 3 or deeper is prefixed with the id of its nearest
 * enclosing heading at level 2 or deeper. Repeated ids get `-1`, `-2`, and so
 * on.
 */
export function createHeadingIdGenerator(): HeadingIdGenerator {
  const stack: Array<{ level: number, id: string }> = []
  const counts = new Map<string, number>()
  return (text, level) => {
    let slug = slugifyHeading(text)
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent && parent.level >= 2) slug = `${parent.id}-${slug}`
    stack.push({ level, id: slug })
    const count = counts.get(slug) ?? 0
    counts.set(slug, count + 1)
    return count === 0 ? slug : `${slug}-${count}`
  }
}
