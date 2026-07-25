import { canonicalizeSourcePath, describeId, generateCanonicalKey, generatePath, generateTitle, isDraftPath, isPartialPath, normalizeContentPath, refineUrlPart } from '../core/content/path'
import { DEFAULT_CONTENT_LOCALE } from '../core/content/locale'
import { defineTransformer } from './utils'

export default defineTransformer({
  name: 'path-meta',
  extensions: ['.*'],
  transform (content, options: any = {}) {
    const { locales = [], defaultLocale = DEFAULT_CONTENT_LOCALE, respectPathCase = false, translatedSlugs = false } = options
    const { source, file, path, extension, basename } = describeId(content.id)
    const parts = path.split('/')
    // Check first part for locale name
    const locale = locales.includes(parts[0]) ? parts.shift() : defaultLocale
    const isNavigation = basename === '.navigation'
    const rawPath = isNavigation ? parts.slice(0, -1).join('/') : parts.join('/')
    const filePath = generatePath(rawPath, { respectPathCase })
    const collection = isNavigation ? undefined : options.collectionResolver?.(file)
    const localePolicy = collection ? options.localePolicy?.[collection] : undefined
    const localeMount = localePolicy?.localized
      ? localePolicy.routeMounts?.[locale]
      : localePolicy?.routeMounts?.default
    const normalizedMount = localeMount ? normalizeContentPath(localeMount) : undefined
    const canonicalSource = canonicalizeSourcePath(filePath, normalizedMount)
    const contentPath = canonicalSource.path
    const removedSegments = canonicalSource.removedSegments
    const canonicalParts = parts.slice(removedSegments)
    const canonicalKey = generateCanonicalKey(canonicalParts, { translatedSlugs, respectPathCase })
    // Fallback title synthesis lives here (not in the markdown parser) so it
    // applies uniformly to every parser output. Moving it into the markdown
    // parser would duplicate the logic in the yaml / json / csv parsers.
    const title = content.title || (isNavigation ? undefined : generateTitle(refineUrlPart(basename)))

    return {
      ...content,
      // Every system-computed field below is conditionally spread rather than
      // assigned `undefined` directly: the canonical JSON value model
      // rejects `undefined` values, and both `collection`
      // (no matching collection glob) and `title` (navigation files) are
      // legitimately absent for large classes of documents.
      ...(typeof title !== 'undefined' ? { title } : {}),
      ...(!isNavigation ? { path: contentPath, canonicalKey } : {}),
      draft: content.draft || isDraftPath(path),
      partial: isNavigation || isPartialPath(path),
      locale,
      ...(typeof collection !== 'undefined' ? { collection } : {}),
      navigationFile: isNavigation,
      file: {
        source,
        path: file,
        stem: path,
        dir: filePath.split('/').slice(-2)[0],
        extension
      }
    }
  }
})
export { describeId, generateCanonicalKey, generatePath, generateTitle, refineUrlPart }
