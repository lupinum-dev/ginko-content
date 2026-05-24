/**
 * Build the navigation tree from a flat list of content metadata.
 *
 * The input is a flat list of content rows with `title`, `_path`, `_file`, and
 * optional extra fields; the output is a `NavItem[]` tree where parent folders
 * are synthesized from path segments and `/.navigation.yml` config entries
 * can override titles and metadata per directory.
 *
 * Key behaviors to know before touching this code:
 *
 *  - **Index-file promotion** — a `guide/index.md` becomes the `guide`
 *    folder's own nav entry, not a child. Its siblings-under-`guide`
 *    become its children.
 *  - **`.navigation.yml`** — `configs['/guide']` can set `navigation: false`
 *    on a directory to hide the entire subtree from navigation; or
 *    override `title`/other fields.
 *  - **Natural sort** — siblings sort by `_file` (filename without the
 *    extension) via `Intl.Collator({ numeric: true })`, so `10-foo` comes
 *    after `2-foo`, not between `1-foo` and `20-foo`.
 *  - **Two-pass shaping** — we build a mutable canonical tree, then project it
 *    into the public navigation contract. Synthetic folders keep canonical
 *    identity internally and become pathless public groups at the projection
 *    boundary.
 */
import type { NavItem, ParsedContentMeta } from '../../types/content'
import { generateTitle } from '../../core/content/path'
import { type CanonicalNavigationItem, projectNavigationTree } from './canonical'

type PrivateNavItem = CanonicalNavigationItem

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const pick = (keys?: string[]) => (obj: any) => {
  const target = obj || {}
  if (!keys?.length) {
    return target
  }

  return keys
    .filter(key => typeof target[key] !== 'undefined')
    .reduce((newObject, key) => Object.assign(newObject, { [key]: target[key] }), {})
}

const isObject = (value: any) => Object.prototype.toString.call(value) === '[object Object]'

const parentCanonicalKey = (content: ParsedContentMeta, depth: number) => {
  const canonicalKey = (content as any)._canonicalKey
  if (typeof canonicalKey !== 'string' || !canonicalKey) {
    return undefined
  }

  return canonicalKey.split('/').slice(0, depth + 1).join('/') || undefined
}

/**
 * Post-process the mutable tree: sort siblings by basename and recurse.
 * Projection is the only place that strips canonical folder paths.
 */
const sortCanonicalTree = (items: PrivateNavItem[]) => {
  items.forEach((item) => {
    if (item._file) {
      item._file = item._file.split('.').slice(0, -1).join('.')
    }
  })
  const sorted = items.sort((left, right) => collator.compare(left._file || '', right._file || ''))

  for (const item of sorted) {
    if (item.children?.length) {
      sortCanonicalTree(item.children)
    } else {
      delete item.children
    }
  }

  return items
}

export const buildCanonicalNavigation = (
  contents: ParsedContentMeta[],
  configs: Record<string, ParsedContentMeta>,
  fields: string[] = []
): CanonicalNavigationItem[] => {
  const pickNavigationFields = (content: ParsedContentMeta) => ({
    ...pick(['title', ...fields])(content),
    ...(isObject(content?.navigation) ? content.navigation : {})
  })

  const navigation = contents
    .sort((left, right) => left._path!.localeCompare(right._path!))
    .reduce((nav, content) => {
      const parts = content._path!.substring(1).split('/')
      const idParts = content._id.split(':').slice(1)
      const isIndex = Boolean(idParts[idParts.length - 1]?.match(/([1-9][0-9]*\.)?index.md/g))
      const navItem: PrivateNavItem = {
        title: content.title,
        _path: content._path,
        path: content._path,
        _file: content._file,
        _id: content._id,
        _canonicalKey: (content as any)._canonicalKey,
        _locale: (content as any)._locale,
        _navigationKind: 'page',
        _navigationPath: content._path,
        children: [],
        ...pickNavigationFields(content),
        ...(content._draft ? { _draft: true } : {})
      }

      if (isIndex) {
        const dirConfig = configs[navItem._path]
        if (typeof dirConfig?.navigation !== 'undefined' && !dirConfig.navigation) {
          return nav
        }

        if (dirConfig) {
          Object.assign(navItem, pickNavigationFields(dirConfig))
        }
      }

      if (parts.length === 1) {
        nav.push(navItem)
        return nav
      }

      const siblings = parts.slice(0, -1).reduce((nodes, part, index) => {
        const currentPathPart = `/${parts.slice(0, index + 1).join('/')}`
        const config = configs[currentPathPart]
        if (typeof config?.navigation !== 'undefined' && !config.navigation) {
          return []
        }

        let parent = nodes.find(node => node.path === currentPathPart)
        if (!parent) {
          const canonicalKey = parentCanonicalKey(content, index)
          parent = {
            title: generateTitle(part),
            _path: currentPathPart,
            path: currentPathPart,
            _file: content._file,
            _navigationKind: 'folder',
            _navigationPath: currentPathPart,
            page: false,
            ...(canonicalKey ? { _canonicalKey: canonicalKey } : {}),
            ...((content as any)._locale ? { _locale: (content as any)._locale } : {}),
            children: [],
            ...(config && pickNavigationFields(config))
          }
          nodes.push(parent)
        }

        return parent.children!
      }, nav)

      siblings.push(navItem)
      return nav
    }, [] as PrivateNavItem[])

  return sortCanonicalTree(navigation)
}

export const buildNavigation = (
  contents: ParsedContentMeta[],
  configs: Record<string, ParsedContentMeta>,
  fields: string[] = []
): NavItem[] => {
  return projectNavigationTree(buildCanonicalNavigation(contents, configs, fields)) as NavItem[]
}
