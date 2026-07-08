import type { ParsedContent } from '../types/content'
import { describeId, generateCanonicalKey, generatePath, generateTitle, isDraftPath, isPartialPath, refineUrlPart } from '../core/content/path'
import { defineTransformer } from './utils'

export default defineTransformer({
  name: 'path-meta',
  extensions: ['.*'],
  transform (content, options: any = {}) {
    const { locales = [], defaultLocale = 'en', respectPathCase = false, translatedSlugs = false } = options
    const { source, file, path, extension, basename } = describeId(content.id)
    const parts = path.split('/')
    // Check first part for locale name
    const locale = locales.includes(parts[0]) ? parts.shift() : defaultLocale
    const isNavigation = basename === '.navigation'
    const rawPath = isNavigation ? parts.slice(0, -1).join('/') : parts.join('/')
    const filePath = generatePath(rawPath, { respectPathCase })
    const canonicalKey = generateCanonicalKey(isNavigation ? parts.slice(0, -1) : parts, { translatedSlugs, respectPathCase })
    const collection = options.collectionResolver?.(file)

    return {
      ...content,
      // Fallback title synthesis lives here (not in the markdown parser) so it
      // applies uniformly to every parser output. Moving it into the markdown
      // parser would duplicate the logic in the yaml / json / csv parsers.
      title: content.title || (isNavigation ? undefined : generateTitle(refineUrlPart(basename))),
      path: filePath,
      draft: content.draft || isDraftPath(path),
      partial: isNavigation || isPartialPath(path),
      locale,
      canonicalKey,
      collection,
      navigationFile: isNavigation,
      file: {
        source,
        path: file,
        stem: path,
        dir: filePath.split('/').slice(-2)[0],
        extension
      }
    } as unknown as ParsedContent
  }
})
export { describeId, generateCanonicalKey, generatePath, generateTitle, refineUrlPart }
