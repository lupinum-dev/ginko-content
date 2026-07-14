import type { ParsedContent } from '../../types/content'
import type { ContentGraph } from '../../core/content/graph'
import { resolveGraphCanonicalKey } from '../../core/content/graph'
import { parseRefLink } from '../../core/references/resolve'
import type { ContentRouteRecord } from '../localization/route-projector'
import type { ContentLinksOptions, ContentValidationRouteFacts } from '../../types/module'
import type { ContentValidationFinding } from './report'

interface ContentLinkValidationOptions {
  routes: readonly ContentRouteRecord[]
  graph: ContentGraph
  defaultLocale?: string
  links?: ContentLinksOptions
  routeFacts?: ContentValidationRouteFacts
  assetExists: (document: ParsedContent, assetPath: string) => boolean | Promise<boolean>
}

interface AuthoredReference {
  kind: 'link' | 'asset'
  value: string
}

const normalizePath = (path: string) => {
  const normalized = path.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

const collectDocumentFacts = (document: ParsedContent) => {
  const anchors = new Set<string>()
  const references: AuthoredReference[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const value = node as { tag?: unknown, props?: unknown, children?: unknown }
    const props = value.props && typeof value.props === 'object' ? value.props as Record<string, unknown> : {}
    if (typeof value.tag === 'string' && /^h[1-6]$/.test(value.tag) && typeof props.id === 'string') anchors.add(props.id)
    if (value.tag === 'img' && typeof props.src === 'string') references.push({ kind: 'asset', value: props.src })
    for (const property of ['href', 'to'] as const) {
      if (typeof props[property] === 'string') references.push({ kind: 'link', value: props[property] })
    }
    if (Array.isArray(value.children)) value.children.forEach(visit)
  }
  visit(document.body)
  return { anchors, references }
}

const isExternalReference = (value: string) => /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)
const isAssetPath = (path: string) => /\/[^/]+\.[a-z\d]{1,10}$/i.test(path) && !/\.html?$/i.test(path)
const identityKey = (collection: string | undefined, canonicalKey: string | undefined, locale: string | undefined) =>
  `${collection || ''}\0${canonicalKey || ''}\0${locale || ''}`

const createAppRouteMatcher = (facts?: ContentValidationRouteFacts) => {
  const patterns = (facts?.patterns || []).map(pattern => new RegExp(pattern.source, pattern.flags))
  return (path: string) => patterns.some(pattern => pattern.test(path))
}

const configuredQuickLink = (value: string, links: ContentLinksOptions | undefined) => {
  const parsed = parseRefLink(value)
  if (!parsed) return
  const separator = parsed.ref.indexOf('.')
  if (separator <= 0 || separator === parsed.ref.length - 1) return
  return links?.[parsed.ref.slice(0, separator)]?.[parsed.ref.slice(separator + 1)]
}

/** Validate authored links against the canonical graph and projected public routes. */
export const validateContentLinks = async (
  documents: ParsedContent[],
  options: ContentLinkValidationOptions
): Promise<ContentValidationFinding[]> => {
  const routeByIdentity = new Map(options.routes.map(route => [identityKey(route.collection, route.canonicalKey, route.locale), route]))
  const documentByRoute = new Map<string, ParsedContent>()
  const anchorsByRoute = new Map<string, Set<string>>()
  const facts = new Map<ParsedContent, ReturnType<typeof collectDocumentFacts>>()
  for (const document of documents) {
    const documentFacts = collectDocumentFacts(document)
    facts.set(document, documentFacts)
    const route = routeByIdentity.get(identityKey(document.collection, document.canonicalKey, document.locale))
    if (route && !document.partial && !document.draft) {
      const path = normalizePath(route.path)
      documentByRoute.set(path, document)
      anchorsByRoute.set(path, documentFacts.anchors)
    }
  }

  const matchesAppRoute = createAppRouteMatcher(options.routeFacts)
  const namedRoutes = options.routeFacts?.named || {}
  const findings: ContentValidationFinding[] = []
  let externalLinks = 0

  const addBroken = (file: string, value: string, resolved?: string) => findings.push({
    severity: 'error',
    file,
    message: resolved
      ? `Broken internal link "${value}" (resolved to "${resolved}").`
      : `Broken internal reference "${value}".`,
    suggestion: 'Link to a canonical content route or a concrete Nuxt app route.'
  })

  for (const document of documents) {
    if (document.type !== 'markdown' || document.partial || document.draft) continue
    const sourceFile = document.file?.path || document.id
    const sourceRoute = routeByIdentity.get(identityKey(document.collection, document.canonicalKey, document.locale))
    if (!sourceRoute) continue

    for (const reference of facts.get(document)?.references || []) {
      const authoredValue = reference.value.trim()
      if (!authoredValue) continue
      if (isExternalReference(authoredValue)) {
        externalLinks++
        continue
      }

      const parsedRef = parseRefLink(authoredValue)
      if (parsedRef) {
        const quickLink = configuredQuickLink(authoredValue, options.links)
        if (quickLink) {
          const route = namedRoutes[quickLink.route]
          if (!route) {
            findings.push({
              severity: 'error', file: sourceFile,
              message: `Configured quick link "${authoredValue}" references missing Nuxt route name "${quickLink.route}".`,
              suggestion: 'Correct the quick-link route name or add the named Nuxt page route.'
            })
          } else {
            const missingParam = route.requiredParams.find((param) => {
              const value = quickLink.params?.[param]
              return value === undefined || value === null || value === ''
            })
            if (missingParam) findings.push({
              severity: 'error', file: sourceFile,
              message: `Configured quick link "${authoredValue}" is missing required route parameter "${missingParam}".`,
              suggestion: `Add params.${missingParam} to the configured quick link.`
            })
          }
          continue
        }

        const canonicalKey = resolveGraphCanonicalKey(options.graph, parsedRef.ref)
        const variants = canonicalKey ? options.graph.byCanonical[canonicalKey] : undefined
        const variant = variants?.[document.locale || '']
          || variants?.[options.defaultLocale || '']
          || Object.values(variants || {})[0]
        const targetDocument = variant ? options.graph.byId[variant.contentId] : undefined
        const targetRoute = targetDocument
          ? routeByIdentity.get(identityKey(targetDocument.collection, canonicalKey || '', variant?.locale))
          : undefined
        if (!targetRoute) {
          addBroken(sourceFile, authoredValue)
          continue
        }
        const anchor = parsedRef.hash ? parsedRef.hash.slice(1) : undefined
        if (anchor && !anchorsByRoute.get(normalizePath(targetRoute.path))?.has(anchor)) {
          findings.push({
            severity: 'error', file: sourceFile,
            message: `Missing anchor "#${anchor}" on "${targetRoute.path}".`,
            suggestion: 'Correct the fragment or add a heading with that generated id.'
          })
        }
        continue
      }

      let resolved: { path: string, anchor?: string }
      try {
        const url = new URL(authoredValue, `https://ginko.invalid${sourceRoute.path === '/' ? '/' : sourceRoute.path}`)
        resolved = {
          path: normalizePath(decodeURIComponent(url.pathname)),
          anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined
        }
      } catch {
        findings.push({
          severity: 'error', file: sourceFile,
          message: `Malformed internal reference "${authoredValue}".`,
          suggestion: 'Use a valid URL path and percent-encode special characters.'
        })
        continue
      }

      const targetDocument = documentByRoute.get(resolved.path)
      if (reference.kind === 'asset' || (!targetDocument && isAssetPath(resolved.path))) {
        const authoredAssetPath = decodeURIComponent(authoredValue.split(/[?#]/, 1)[0] || '')
        if (!await options.assetExists(document, authoredAssetPath)) {
          findings.push({
            severity: 'error', file: sourceFile,
            message: `Missing asset "${authoredValue}".`,
            suggestion: 'Add the asset under public/ or next to its source document, or correct the path.'
          })
        }
        continue
      }

      if (!targetDocument) {
        if (!matchesAppRoute(resolved.path)) addBroken(sourceFile, authoredValue, resolved.path)
        continue
      }
      if (resolved.anchor && !anchorsByRoute.get(resolved.path)?.has(resolved.anchor)) {
        findings.push({
          severity: 'error', file: sourceFile,
          message: `Missing anchor "#${resolved.anchor}" on "${resolved.path}".`,
          suggestion: 'Correct the fragment or add a heading with that generated id.'
        })
      }
    }
  }

  if (externalLinks) findings.push({
    severity: 'info', file: 'external links',
    message: `${externalLinks} external link${externalLinks === 1 ? '' : 's'} skipped.`,
    suggestion: 'Use a dedicated network link checker in CI if external availability must be verified.'
  })
  return findings.sort((left, right) => `${left.severity}:${left.file}:${left.message}`.localeCompare(`${right.severity}:${right.file}:${right.message}`))
}
