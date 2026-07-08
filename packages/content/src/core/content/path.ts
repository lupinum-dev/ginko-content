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
    .filter(([, mount]) => normalized === mount || normalized.startsWith(`${mount}/`))
    .sort((a, b) => b[1].length - a[1].length)[0]
}

export const routeRemainder = (path: string, mount: string) => {
  const normalizedPath = normalizeContentPath(path)
  const normalizedMount = normalizeContentPath(mount)
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
  return normalizeContentPath(suffix === '/' ? mount : `${mount}${suffix}`)
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

export const projectContentPathToLocale = (
  path: string,
  locale?: string,
  defaultLocale?: string,
  mounts?: RouteMounts
) => {
  const normalizedPath = normalizeContentPath(path || '/')
  if (normalizedPath === '/') {
    return prefixPathWithLocale(normalizedPath, locale, defaultLocale)
  }

  if (!locale || !mounts) {
    return prefixPathWithLocale(normalizedPath, locale, defaultLocale)
  }

  const source = longestMountForPath(normalizedPath, mounts)
  const remainder = source ? routeRemainder(normalizedPath, source[1]) : normalizedPath
  return prefixPathWithLocale(mountContentPath(remainder, locale, mounts), locale, defaultLocale)
}

export const pathHasLocalePrefix = isLocalePrefixedPath
