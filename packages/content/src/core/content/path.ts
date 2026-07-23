import { pascalCase } from 'scule'
import { withLeadingSlash, withoutTrailingSlash } from 'ufo'
import { slugifyUrlSegment } from './slug'

const SEMVER_REGEX = /^(\d+)(\.\d+)*(\.x)?$/
const NUMERIC_PREFIX_RE = /^(\d+)\.(.+)$/

export const describeId = (id: string) => {
  const [source, ...parts] = id.split(':')
  const [, basename, extension] = parts[parts.length - 1]?.match(/(.*)\.([^.]+)$/) || []

  if (basename) {
    parts[parts.length - 1] = basename
  }

  const path = (parts || []).join('/')

  return {
    source,
    path,
    extension,
    file: extension ? `${path}.${extension}` : path,
    basename: basename || ''
  }
}

export const isDraftPath = (path: string): boolean => /\.draft(\/|\.|$)/.test(path)

export const isPartialPath = (path: string): boolean => path.split(/[:/]/).some(part => /^_.*/.test(part))

export const normalizeContentPath = (path: string) => {
  if (!path || path === '/') {
    return '/'
  }

  return path.endsWith('/') ? path.slice(0, -1) || '/' : path
}

/**
 * Validate and normalize a provider-authored content route.
 *
 * Provider route facts are site-relative pathnames, never URLs or browser
 * locations. Keeping this validation beside the canonical path normalizer
 * gives query documents and auxiliary provider operations one acceptance
 * rule instead of two subtly different public route boundaries.
 */
export const normalizeSiteRelativeContentPath = (value: string): string => {
  const hasControlCharacter = (input: string) => [...input].some((character) => {
    const code = character.codePointAt(0)!
    return code <= 31 || code === 127
  })

  if (
    !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || /[\s"<>]/u.test(value)
    || hasControlCharacter(value)
  ) {
    throw new TypeError('contentPath must be a leading-slash, site-relative content route')
  }

  try {
    const parsed = new URL(value, 'https://ginko.invalid')
    // Always decode once, even when WHATWG URL parsing preserved the source.
    // The previous short-circuit admitted malformed percent escapes because
    // `decodeURI` never ran for the common `parsed.pathname === value` case.
    const decodedPathname = decodeURI(parsed.pathname)
    const decoded = decodeURIComponent(value)
    const decodedSegments = decoded.split('/')
    const hasEncodedSeparator = /%(?:2f|5c)/iu.test(value)
    const hasUnsafeDecodedWhitespace = [...decoded].some(character => character !== ' ' && /\s/u.test(character))
    const hasUnsafeDecodedCharacter = decoded.includes('\\') || decoded.includes('?') || decoded.includes('#') || /["<>]/u.test(decoded)
    const hasDecodedTraversal = decodedSegments.some(segment => segment === '.' || segment === '..')
    const sourcePreserved = parsed.pathname === value || decodedPathname === value
    if (parsed.origin !== 'https://ginko.invalid' || !sourcePreserved) {
      throw new TypeError('contentPath must be a leading-slash, site-relative content route')
    }
    if (
      hasControlCharacter(decoded)
      || hasEncodedSeparator
      || hasUnsafeDecodedWhitespace
      || hasUnsafeDecodedCharacter
      || hasDecodedTraversal
    ) {
      throw new TypeError('contentPath must be a leading-slash, site-relative content route')
    }
  } catch {
    throw new TypeError('contentPath must be a leading-slash, site-relative content route')
  }

  return normalizeContentPath(value)
}

export function refineUrlPart(name: string): string {
  name = name.split(/[/:]/).pop()!
  if (SEMVER_REGEX.test(name)) {
    return name
  }

  return name
    .replace(/(\d+\.)?(.*)/, '$2')
    .replace(/^index(\.draft)?$/, '')
    .replace(/\.draft$/, '')
}

export const generatePath = (
  path: string,
  { forceLeadingSlash = true, respectPathCase = false }: { forceLeadingSlash?: boolean, respectPathCase?: boolean } = {}
): string => {
  const generatedPath = path
    .split('/')
    .map(part => slugifyUrlSegment(refineUrlPart(part), { lower: !respectPathCase }))
    .join('/')

  return forceLeadingSlash ? withLeadingSlash(withoutTrailingSlash(generatedPath)) : generatedPath
}

const parseSegment = (part: string) => {
  const base = part.split(/[/:]/).pop() || ''
  const refined = refineUrlPart(base)
  const match = base.match(NUMERIC_PREFIX_RE)

  return {
    refined,
    number: match?.[1]
  }
}

export const generateCanonicalKey = (
  parts: string[],
  { translatedSlugs = false, respectPathCase = false }: { translatedSlugs?: boolean, respectPathCase?: boolean } = {}
): string => {
  const segments = parts
    .map(parseSegment)
    .filter(segment => segment.refined.length > 0)

  if (!translatedSlugs) {
    return generatePath(segments.map(segment => segment.refined).join('/'), { respectPathCase }) || '/'
  }

  const translatedSegments = segments.map((segment) => {
    if (segment.number) {
      return segment.number
    }

    return slugifyUrlSegment(segment.refined, { lower: !respectPathCase }) || segment.refined
  })

  return translatedSegments.length ? translatedSegments.join('/') : '/'
}

export const generateTitle = (path: string) => path.split(/[\s-]/g).map(pascalCase).join(' ')

export type RouteMounts = Record<string, string>

export const normalizeRouteMounts = (
  route: string | Record<string, string> | undefined,
  locales: string[] = [],
  defaultLocale?: string
): RouteMounts | undefined => {
  if (!route) {
    return undefined
  }

  if (typeof route === 'string') {
    const localeList = locales.length ? locales : (defaultLocale ? [defaultLocale] : [])
    if (!localeList.length) {
      return defaultLocale ? { [defaultLocale]: normalizeContentPath(route) } : undefined
    }
    return Object.fromEntries(localeList.map(locale => [locale, normalizeContentPath(route)]))
  }

  const entries = Object.entries(route)
    .filter(([, mount]) => typeof mount === 'string' && mount.length > 0)
    .map(([locale, mount]) => [locale, normalizeContentPath(mount)] as const)

  return entries.length ? Object.fromEntries(entries) : undefined
}

export const longestMountForPath = (path: string, mounts: RouteMounts) => {
  const normalized = normalizeContentPath(path)
  return Object.entries(mounts)
    .filter(([, mount]) => {
      const normalizedMount = normalizeContentPath(mount)
      return normalizedMount === '/'
        || normalized === normalizedMount
        || normalized.startsWith(`${normalizedMount}/`)
    })
    .sort((a, b) => b[1].length - a[1].length)[0]
}

export const routeRemainder = (path: string, mount: string) => {
  const normalizedPath = normalizeContentPath(path)
  const normalizedMount = normalizeContentPath(mount)
  if (normalizedMount === '/') {
    return normalizedPath
  }
  if (normalizedPath === normalizedMount) {
    return '/'
  }
  return normalizeContentPath(normalizedPath.slice(normalizedMount.length) || '/')
}

export const mountContentPath = (
  remainder: string,
  locale: string | undefined,
  mounts?: RouteMounts
) => {
  const mount = locale && mounts?.[locale]
  if (!mount) {
    return normalizeContentPath(remainder)
  }
  const suffix = normalizeContentPath(remainder)
  const normalizedMount = normalizeContentPath(mount)
  if (normalizedMount === '/') {
    return suffix
  }
  return normalizeContentPath(suffix === '/' ? normalizedMount : `${normalizedMount}${suffix}`)
}

const isLocalePrefixedPath = (path: string, locales: string[]) => {
  const segments = path.split('/').filter(Boolean)
  return Boolean(segments[0] && locales.includes(segments[0]))
}

export const prefixPathWithLocale = (path: string, locale?: string, defaultLocale?: string) => {
  const normalizedPath = normalizeContentPath(path || '/')

  if (!locale || !defaultLocale || locale === defaultLocale) {
    return normalizedPath
  }

  return normalizedPath === '/'
    ? `/${locale}`
    : `/${locale}${normalizedPath}`
}

export const stripLocalePrefix = (
  path: string,
  locales: string[] = [],
  defaultLocale?: string,
  explicitLocale?: string
) => {
  const normalized = normalizeContentPath(path)
  const segments = normalized.split('/').filter(Boolean)
  const routeLocale = segments[0] && locales.includes(segments[0]) && segments[0] !== defaultLocale ? segments[0] : undefined
  const locale = explicitLocale && locales.includes(explicitLocale)
    ? explicitLocale
    : routeLocale || defaultLocale
  const routePath = routeLocale
    ? normalizeContentPath('/' + segments.slice(1).join('/'))
    : normalized

  return { locale, path: routePath }
}

export const routeToContentPathCandidates = (
  route: string,
  requestedLocale: string | undefined,
  localeChain: string[],
  defaultLocale?: string,
  mounts?: RouteMounts
) => {
  const locales = Array.from(new Set([...Object.keys(mounts || {}), ...localeChain, defaultLocale].filter(Boolean) as string[]))
  const stripped = stripLocalePrefix(route, locales, defaultLocale, requestedLocale)
  if (!mounts) {
    return localeChain.map(locale => ({ locale, path: stripped.path }))
  }

  const activeLocale = stripped.locale || requestedLocale || defaultLocale
  const activeMount = activeLocale ? mounts[activeLocale] : undefined
  const matchedMount = activeMount && (stripped.path === activeMount || stripped.path.startsWith(`${activeMount}/`))
    ? activeMount
    : longestMountForPath(stripped.path, mounts)?.[1]
  const remainder = matchedMount ? routeRemainder(stripped.path, matchedMount) : stripped.path

  return localeChain.map(locale => ({
    locale,
    path: mountContentPath(remainder, locale, mounts)
  }))
}

export const pathHasLocalePrefix = isLocalePrefixedPath
