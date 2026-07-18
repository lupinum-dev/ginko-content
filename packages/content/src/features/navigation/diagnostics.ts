import type { ParsedContentMeta } from '../../types/content'
import { isKnownNavigationSelectField } from '../../types/navigation'
import { isNavigationFile } from '../../core/content/structural'
import { normalizeNavigationPath } from './resolve'

export interface NavigationDiagnostic {
  key: string
  message: string
}

export type NavigationDiagnosticCollections = Record<string, {
  schemaFields?: readonly string[]
}>

type NavigationDocumentWithPath = ParsedContentMeta & { path: string }

const emittedNavigationDiagnostics = new Set<string>()

export const shouldEmitNavigationRuntimeDiagnostics = (
  environment: 'development' | 'production',
  prerender: boolean
): boolean => environment === 'development' || prerender

export const collectUnknownNavigationSelectDiagnostics = (
  fields: readonly string[],
  collection: string | null,
  collections: NavigationDiagnosticCollections | undefined
): NavigationDiagnostic[] => {
  if (!collection) {
    return []
  }

  const schemaFields = collections?.[collection]?.schemaFields
  if (!schemaFields) {
    return []
  }

  const declaredFields = new Set(schemaFields)
  return fields
    .filter(field => !isKnownNavigationSelectField(field) && !declaredFields.has(field))
    .map(field => ({
      key: `select:${collection}:${field}`,
      message: `Navigation select field "${field}" is not declared in collection "${collection}" or the shared navigation vocabulary.`
    }))
}

const effectiveLocale = (document: ParsedContentMeta, defaultLocale?: string) =>
  document.locale || defaultLocale || ''

const isNavigationContent = (document: ParsedContentMeta): document is NavigationDocumentWithPath =>
  document.partial === false
  && document.type === 'markdown'
  && document.navigation !== false
  && typeof document.path === 'string'

const pathBelongsToFolder = (path: string, folderPath: string) =>
  folderPath === '/'
    ? path.startsWith('/')
    : path === folderPath || path.startsWith(`${folderPath}/`)

export const collectUnmatchedNavigationConfigDiagnostics = (
  documents: readonly ParsedContentMeta[],
  options: { locale?: string, defaultLocale?: string } = {}
): NavigationDiagnostic[] => {
  const inRequestedLocale = (document: ParsedContentMeta) =>
    !options.locale || effectiveLocale(document, options.defaultLocale) === options.locale
  const contents = documents.filter((document): document is NavigationDocumentWithPath =>
    inRequestedLocale(document)
    && !isNavigationFile(document)
    && isNavigationContent(document)
  )
  const configs = documents.filter(document => inRequestedLocale(document) && isNavigationFile(document))
  const pathsByLocale = new Map<string, string[]>()

  for (const content of contents) {
    const locale = effectiveLocale(content, options.defaultLocale)
    const paths = pathsByLocale.get(locale) || []
    paths.push(normalizeNavigationPath(content.path))
    pathsByLocale.set(locale, paths)
  }

  const diagnostics: NavigationDiagnostic[] = []
  for (const config of configs) {
    if (typeof config.path !== 'string') {
      continue
    }

    const locale = effectiveLocale(config, options.defaultLocale)
    const configPath = normalizeNavigationPath(config.path)
    const matchesContent = (pathsByLocale.get(locale) || [])
      .some(path => pathBelongsToFolder(path, configPath))
    if (matchesContent) {
      continue
    }

    const file = config.file?.path || config.id
    diagnostics.push({
      key: `config:${locale || '*'}:${file}:${configPath}`,
      message: `.navigation.yml "${file}" does not match any navigation folder for locale "${locale || 'default'}".`
    })
  }

  return diagnostics
}

export const emitNavigationDiagnostics = (
  diagnostics: readonly NavigationDiagnostic[],
  warn: (message: string) => void = console.warn
): void => {
  for (const diagnostic of diagnostics) {
    if (emittedNavigationDiagnostics.has(diagnostic.key)) {
      continue
    }

    emittedNavigationDiagnostics.add(diagnostic.key)
    warn(`[ginko-content] ${diagnostic.message}`)
  }
}
