/** Core-owned structural modes accepted by navigation metadata. */
export const NAVIGATION_SIDEBAR_VALUES = ['section', 'group'] as const

export type NavigationSidebar = typeof NAVIGATION_SIDEBAR_VALUES[number]

/** Core-owned metadata shared by navigation files and page frontmatter. */
export interface SharedNavigationMetadata {
  sidebar?: NavigationSidebar
}

/** User-authored fields with navigation-specific meaning. */
export const NAVIGATION_SHARED_FIELDS = [
  'badge',
  'description',
  'hidden',
  'icon',
  'navigation',
  'order',
  'sidebar',
  'title'
] as const

/** Fields every navigation request needs to build the canonical tree. */
export const NAVIGATION_REQUIRED_FIELDS = [
  'id',
  'path',
  'file',
  'canonicalKey',
  'locale',
  'draft',
  'navigation',
  'title'
] as const

const navigationSelectFields = new Set<string>([
  ...NAVIGATION_SHARED_FIELDS,
  ...NAVIGATION_REQUIRED_FIELDS
])

const navigationSidebarValues = new Set<string>(NAVIGATION_SIDEBAR_VALUES)

export const isNavigationSidebar = (value: unknown): value is NavigationSidebar =>
  typeof value === 'string' && navigationSidebarValues.has(value)

export const isKnownNavigationSelectField = (field: string): boolean =>
  navigationSelectFields.has(field)
