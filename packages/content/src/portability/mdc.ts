import { parse } from 'comark'

import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import type { PortableComponentPolicyV1 } from '../cms-contract/types.js'
import { portabilityError, type GinkoBoundaryError } from './errors.js'

export interface PortableMdcAstV1 {
  format: 'ginko-portable-mdc-ast'
  version: 1
  source: string
  nodes: JsonValue[]
}

export interface PortableMdcIssue {
  code: 'MDC_UNSUPPORTED'
  message: string
  line: number
  column: number
}

export type PortableMdcClassification =
  | { classification: 'portable'; ast: PortableMdcAstV1; issues: [] }
  | { classification: 'rejected'; ast: null; issues: PortableMdcIssue[] }

const builtins = new Set(['p', 'span', 'strong', 'em', 'del', 'a', 'img', 'ul', 'ol', 'li', 'blockquote', 'hr', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

export async function parsePortableMdc(source: string, policy: PortableComponentPolicyV1): Promise<PortableMdcAstV1> {
  return await parseMdc(source, policy, false)
}

export async function parseStoredMdc(source: string, policy: PortableComponentPolicyV1): Promise<PortableMdcAstV1> {
  return await parseMdc(source, policy, true)
}

async function parseMdc(source: string, policy: PortableComponentPolicyV1, allowStoredAssets: boolean): Promise<PortableMdcAstV1> {
  if (source.includes('\uFEFF')) throw unsupported()
  const normalized = normalizeBody(source)
  let tree: Awaited<ReturnType<typeof parse>>
  try {
    tree = await parse(normalized)
  } catch {
    throw unsupported()
  }
  validateNodes(tree.nodes as unknown[], policy, allowStoredAssets)
  const nodes = stripPositions(tree.nodes) as JsonValue[]
  canonicalJsonBytes(nodes)
  return { format: 'ginko-portable-mdc-ast', version: 1, source: normalized, nodes }
}

export async function serializePortableMdc(ast: PortableMdcAstV1, policy: PortableComponentPolicyV1): Promise<string> {
  if (ast.format !== 'ginko-portable-mdc-ast' || ast.version !== 1 || typeof ast.source !== 'string' || !Array.isArray(ast.nodes)) throw unsupported()
  const reparsed = await parsePortableMdc(ast.source, policy)
  if (JSON.stringify(reparsed.nodes) !== JSON.stringify(ast.nodes)) throw unsupported()
  return ast.source
}

export async function classifyPortableMdc(source: string, policy: PortableComponentPolicyV1): Promise<PortableMdcClassification> {
  try {
    return { classification: 'portable', ast: await parsePortableMdc(source, policy), issues: [] }
  } catch (error) {
    const boundary = error as Partial<GinkoBoundaryError>
    return { classification: 'rejected', ast: null, issues: [{ code: 'MDC_UNSUPPORTED', message: boundary.message ?? 'MDC syntax is unsupported.', line: 1, column: 1 }] }
  }
}

export function portableMdcSemanticallyEqual(left: PortableMdcAstV1, right: PortableMdcAstV1): boolean {
  return JSON.stringify(left.nodes) === JSON.stringify(right.nodes)
}

function validateNodes(nodes: unknown[], policy: PortableComponentPolicyV1, allowStoredAssets: boolean): void {
  for (const node of nodes) {
    if (typeof node === 'string') continue
    if (!Array.isArray(node) || typeof node[0] !== 'string') throw unsupported()
    const tag = node[0]
    const props = node[1] && typeof node[1] === 'object' && !Array.isArray(node[1]) ? node[1] as Record<string, unknown> : {}
    if ('$' in props || tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'svg') throw unsupported()
    const component = policy.components[tag]
    if (!builtins.has(tag) && !component) throw unsupported()
    for (const [key, value] of Object.entries(props)) {
      if (/^(?:on|v-|[:@#])/i.test(key)) throw unsupported()
      if (component) {
        const rule = component.props[key]
        if (!rule || !matchesProp(value, rule.type, allowStoredAssets)) throw unsupported()
      }
      const storageAssetProp = (tag === 'img' && key === 'src') || component?.props[key]?.type === 'asset'
      if (
        (key === 'href' || key === 'src') &&
        typeof value === 'string' &&
        !safeUrl(value) &&
        !(allowStoredAssets && storageAssetProp && storedAssetIdentity(value))
      ) throw unsupported()
    }
    if (component) for (const [key, rule] of Object.entries(component.props)) if (rule.required && !(key in props)) throw unsupported()
    validateNodes(node.slice(2), policy, allowStoredAssets)
  }
}

const matchesProp = (value: unknown, type: string, allowStoredAssets: boolean) => type === 'json'
  ? isJson(value)
  : type === 'asset'
    ? typeof value === 'string' && (safeUrl(value) || (allowStoredAssets && storedAssetIdentity(value)))
    : typeof value === type
const isJson = (value: unknown) => {
  try { canonicalJsonBytes(value as JsonValue); return true } catch { return false }
}
const safeUrl = (value: string) => {
  if (/^[/.#]/.test(value) && !value.startsWith('//')) return !hasUrlControl(value)
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}
const hasUrlControl = (value: string) => [...value].some(character => character === '\\' || character.codePointAt(0)! <= 31)
const storedAssetIdentity = (value: string) => /^[a-z0-9;:_-]{1,512}$/i.test(value)
const stripPositions = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stripPositions)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !['position', 'loc'].includes(key)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stripPositions(child)]))
    : value
export const normalizePortableMdcSource = normalizeBody
function normalizeBody(source: string): string {
  if (source.includes('\uFEFF')) throw unsupported()
  return source.replace(/\r\n?/g, '\n').replace(/\n+$/g, '')
}
const unsupported = () => portabilityError('MDC_UNSUPPORTED', 'portability.validateMdc', 'MDC syntax is unsupported.')
