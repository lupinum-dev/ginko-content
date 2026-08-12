import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import { validatePublicMarkdownAst, validateStoredPortableMarkdownAst } from '../cms-contract/render-policy.js'
import type { PortableComponentPolicyV1 } from '../cms-contract/types.js'
import { normalizeComarkNodes } from '../core/markdown/normalize-comark.js'
import { parseComark } from '../core/markdown/parse-comark.js'
import { toMarkdownRoot } from '../core/markdown/tree.js'
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

export async function parsePortableMdc(source: string, policy: PortableComponentPolicyV1): Promise<PortableMdcAstV1> {
  return await parseMdc(source, policy, false)
}

export async function parseStoredMdc(source: string, policy: PortableComponentPolicyV1): Promise<PortableMdcAstV1> {
  return await parseMdc(source, policy, true)
}

async function parseMdc(source: string, policy: PortableComponentPolicyV1, allowStoredAssets: boolean): Promise<PortableMdcAstV1> {
  if (source.includes('\uFEFF')) throw unsupported()
  const normalized = normalizeBody(source)
  let tree: Awaited<ReturnType<typeof parseComark>>
  try {
    tree = await parseComark(normalized)
  } catch {
    throw unsupported()
  }
  const normalizedNodes = normalizeComarkNodes(tree.nodes as unknown[])
  const nodes = stripPositions(normalizedNodes) as JsonValue[]
  const body = toMarkdownRoot(normalizedNodes)
  const validation = allowStoredAssets
    ? validateStoredPortableMarkdownAst(body, policy)
    : validatePublicMarkdownAst(body, policy)
  if (!validation.ok) throw unsupported()
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
