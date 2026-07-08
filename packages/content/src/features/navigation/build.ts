/**
 * Build the navigation tree from a flat list of content metadata.
 *
 * The input is a flat list of content rows with `title`, `path`, `file`, and
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
 *  - **Natural sort** — siblings sort by `file.path` (filename without the
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
  const canonicalKey = (content as any).canonicalKey
  if (typeof canonicalKey !== 'string' || !canonicalKey) {
    return undefined
  }

  return canonicalKey.split('/').slice(0, depth + 1).join('/') || undefined
}

/**
 * Post-process the mutable tree: sort siblings by basename and recurse.
 * Projection is the only place that strips canonical folder paths.
 */
const sortBasename = (item: PrivateNavItem) => {
  const path = item.file?.path
  return typeof path === 'string' ? path.split('.').slice(0, -1).join('.') : ''
}

const sortCanonicalTree = (items: PrivateNavItem[]) => {
  const sorted = items.sort((left, right) => collator.compare(sortBasename(left), sortBasename(right)))

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
  const pickNavigationFields = (content: ParsedContentMeta) => {
    const navigationFields = isObject(content?.navigation) ? content.navigation as Record<string, unknown> : {}
    return {
      ...pick(['title', ...fields])(content),
      ...navigationFields
    }
  }

  const navigation = contents
    .sort((left, right) => left.path!.localeCompare(right.path!))
    .reduce((nav, content) => {
      const parts = content.path!.substring(1).split('/')
      const idParts = content.id.split(':').slice(1)
      const isIndex = Boolean(idParts[idParts.length - 1]?.match(/([1-9][0-9]*\.)?index.md/g))
      const navItem: PrivateNavItem = {
        title: content.title,
        path: content.path,
        file: content.file,
        id: content.id,
        canonicalKey: (content as any).canonicalKey,
        _locale: (content as any)._locale,
        _navigationKind: 'page',
        _navigationPath: content.path,
        children: [],
        ...pickNavigationFields(content),
        ...(content.draft ? { draft: true } : {})
      }

      if (isIndex) {
        const dirConfig = navItem.path ? configs[navItem.path] : undefined
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
            path: currentPathPart,
            file: content.file,
            _navigationKind: 'folder',
            _navigationPath: currentPathPart,
            page: false,
            ...(canonicalKey ? { canonicalKey: canonicalKey } : {}),
            ...((content as any)._locale ? { _locale: (content as any)._locale } : {}),
            children: [],
            ...(config && pickNavigationFields(config))
          }
          nodes.push(parent as CanonicalNavigationItem)
        }

        if (!parent) {
          return []
        }
        const resolvedParent = parent
        resolvedParent.children ||= []
        return resolvedParent.children
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
