import type { ParsedContent } from '../types/content'
import { describeId, generateCanonicalKey, generatePath, generateTitle, isDraftPath, isPartialPath, refineUrlPart } from '../core/content/path'
import { defineTransformer } from './utils'

export default defineTransformer({
  name: 'path-meta',
  extensions: ['.*'],
  transform (content, options: any = {}) {
    const { locales = [], defaultLocale = 'en', respectPathCase = false, translatedSlugs = false } = options
    const { _source, _file, _path, _extension, _basename } = describeId(content._id)
    const parts = _path.split('/')
    // Check first part for locale name
    const _locale = locales.includes(parts[0]) ? parts.shift() : defaultLocale
    const isNavigation = _basename === '.navigation'
    const rawPath = isNavigation ? parts.slice(0, -1).join('/') : parts.join('/')
    const filePath = generatePath(rawPath, { respectPathCase })
    const _canonicalKey = generateCanonicalKey(isNavigation ? parts.slice(0, -1) : parts, { translatedSlugs, respectPathCase })
    const _collection = options.collectionResolver?.(_file)

    return {
      ...content,
      // Fallback title synthesis lives here (not in the markdown parser) so it
      // applies uniformly to every parser output. Moving it into the markdown
      // parser would duplicate the logic in the yaml / json / csv parsers.
      title: content.title || (isNavigation ? undefined : generateTitle(refineUrlPart(_basename))),
      _path: filePath,
      _dir: filePath.split('/').slice(-2)[0],
      _draft: content.draft || isDraftPath(_path),
      _partial: isNavigation || isPartialPath(_path),
      _locale,
      _canonicalKey,
      _collection,
      _navigation: isNavigation,
      _source,
      _file,
      _stem: _path,
      _extension
    } as unknown as ParsedContent
  }
})
export { describeId, generateCanonicalKey, generatePath, generateTitle, refineUrlPart }
