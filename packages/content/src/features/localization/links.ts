import { localizePath } from './path'

const LOCALIZED_PROP_KEYS = new Set(['href', 'to', 'path', '_path'])
const LOCALIZED_BOUND_PREFIXES = [':', 'v-bind:'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getBoundPropName = (key: string) => {
  for (const prefix of LOCALIZED_BOUND_PREFIXES) {
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length)
    }
  }

  return null
}

const localizeSerializedBoundProp = (
  key: string,
  value: string,
  locale?: string,
  defaultLocale?: string,
  locales: string[] = []
) => {
  const boundProp = getBoundPropName(key)
  if (!boundProp) {
    return value
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (typeof parsed === 'string' && LOCALIZED_PROP_KEYS.has(boundProp)) {
      return JSON.stringify(localizePath(parsed, locale, defaultLocale, locales))
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isRecord(item)) {
          localizeLinkProps(item, locale, defaultLocale, locales)
        }
      }
      return JSON.stringify(parsed)
    }

    if (isRecord(parsed)) {
      localizeLinkProps(parsed, locale, defaultLocale, locales)
      return JSON.stringify(parsed)
    }
  } catch {
    return value
  }

  return value
}

const localizeDirectLinkKeys = (
  props: Record<string, unknown>,
  locale?: string,
  defaultLocale?: string,
  locales: string[] = []
) => {
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string' && LOCALIZED_PROP_KEYS.has(key)) {
      props[key] = localizePath(value, locale, defaultLocale, locales)
      continue
    }

    if (typeof value === 'string') {
      const localizedValue = localizeSerializedBoundProp(key, value, locale, defaultLocale, locales)
      if (localizedValue !== value) {
        props[key] = localizedValue
      }
    }
  }
}

export const localizeLinkProps = (
  props: Record<string, unknown>,
  locale?: string,
  defaultLocale?: string,
  locales: string[] = []
) => {
  localizeDirectLinkKeys(props, locale, defaultLocale, locales)

  for (const value of Object.values(props)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) {
          localizeLinkProps(item, locale, defaultLocale, locales)
        }
      }
      continue
    }

    if (isRecord(value)) {
      localizeLinkProps(value, locale, defaultLocale, locales)
    }
  }
}
