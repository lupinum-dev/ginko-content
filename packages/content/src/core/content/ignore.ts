/**
 * Creates a predicate for storage keys such as `content:source:docs:intro.md`
 * against configured content ignore patterns.
 */
export function makeIgnored (ignores: string[]): (key: string) => boolean {
  const patterns = ['/\\.', '/-', ...ignores.filter(Boolean)].map(pattern => new RegExp(pattern))

  return function isIgnored(key: string): boolean {
    const path = `/${key.replace(/:/g, '/')}`
    if (path.endsWith('/.navigation.yml')) {
      return false
    }

    return patterns.some(pattern => pattern.test(path))
  }
}
