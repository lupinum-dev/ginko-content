import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, test } from 'vitest'
import { validatePublicMarkdownAst } from '../../packages/content/src/cms-contract/render-policy'
import type { PortableComponentPolicyV1 } from '../../packages/content/src/cms-contract/types'
import { createAgentMarkdownRegistry } from '../../packages/content/src/features/agent/agent-markdown'
import { renderAgentMarkdownBody } from '../../packages/content/src/features/agent/walker'
import { normalizeComarkNodes } from '../../packages/content/src/core/markdown/normalize-comark'
import { parseComark } from '../../packages/content/src/core/markdown/parse-comark'
import { toMarkdownRoot } from '../../packages/content/src/core/markdown/tree'
import { resolveMarkdownPlugins } from '../../packages/content/src/parsers/markdown-plugins'
import { parsePortableMdc, serializePortableMdc } from '../../packages/content/src/portability/mdc'
import MarkdownRenderer from '../../packages/content/src/runtime/app/components/internal/MarkdownRenderer'
import type { ResolvedMarkdownPlugin } from '../../packages/content/src/types/content'

type Profile = 'filesystem-configured' | 'portable-baseline' | 'inline-client-safe'
type StageStatus = 'accepted' | 'rejected' | 'not-reached'

interface CorpusCase {
  id: string
  fixture: string
  profile: Profile
  support: 'supported' | 'known-gap' | 'malformed'
  plugins: ResolvedMarkdownPlugin[]
  expected: {
    raw: StageStatus
    public: StageStatus
    portable: StageStatus
    ssr: StageStatus
    agent: StageStatus
  }
}

const componentPolicy: PortableComponentPolicyV1 = {
  components: {
    callout: {
      kind: 'block',
      props: {
        title: { type: 'string', required: true },
        tone: { type: 'string', required: false },
        count: { type: 'number', required: false },
        featured: { type: 'boolean', required: false },
        options: { type: 'json', required: false }
      },
      slots: ['default', 'actions'],
      media: null
    }
  }
}

const plugin = (name: string, options: Record<string, unknown> = {}): ResolvedMarkdownPlugin => ({
  name,
  options
})

const corpus: CorpusCase[] = [
  {
    id: 'basic',
    fixture: 'basic.md',
    profile: 'filesystem-configured',
    support: 'known-gap',
    plugins: [plugin('toc')],
    expected: { raw: 'accepted', public: 'accepted', portable: 'rejected', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'comments-summary',
    fixture: 'comments-summary.md',
    profile: 'filesystem-configured',
    support: 'known-gap',
    plugins: [plugin('summary')],
    expected: { raw: 'accepted', public: 'rejected', portable: 'rejected', ssr: 'rejected', agent: 'accepted' }
  },
  {
    id: 'components',
    fixture: 'components.md',
    profile: 'portable-baseline',
    support: 'known-gap',
    plugins: [],
    expected: { raw: 'accepted', public: 'rejected', portable: 'rejected', ssr: 'rejected', agent: 'accepted' }
  },
  {
    id: 'gfm',
    fixture: 'gfm.md',
    profile: 'portable-baseline',
    support: 'known-gap',
    plugins: [plugin('footnotes')],
    expected: { raw: 'accepted', public: 'rejected', portable: 'rejected', ssr: 'rejected', agent: 'accepted' }
  },
  {
    id: 'highlight',
    fixture: 'highlight.md',
    profile: 'filesystem-configured',
    support: 'known-gap',
    plugins: [plugin('highlight')],
    expected: { raw: 'accepted', public: 'rejected', portable: 'accepted', ssr: 'rejected', agent: 'accepted' }
  },
  {
    id: 'inline',
    fixture: 'inline.md',
    profile: 'inline-client-safe',
    support: 'supported',
    plugins: [],
    expected: { raw: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'math',
    fixture: 'math.md',
    profile: 'filesystem-configured',
    support: 'known-gap',
    plugins: [plugin('math')],
    expected: { raw: 'accepted', public: 'rejected', portable: 'accepted', ssr: 'rejected', agent: 'accepted' }
  },
  {
    id: 'mermaid',
    fixture: 'mermaid.md',
    profile: 'filesystem-configured',
    support: 'known-gap',
    plugins: [plugin('mermaid')],
    expected: { raw: 'accepted', public: 'rejected', portable: 'accepted', ssr: 'rejected', agent: 'accepted' }
  },
  {
    id: 'malformed',
    fixture: 'malformed.md',
    profile: 'portable-baseline',
    support: 'malformed',
    plugins: [],
    expected: { raw: 'rejected', public: 'not-reached', portable: 'rejected', ssr: 'not-reached', agent: 'not-reached' }
  }
]

const fixturesRoot = resolve('test/fixtures/markdown-conformance')
const readFixture = (fixture: string) => readFile(resolve(fixturesRoot, fixture), 'utf8')
const parseConfigured = async (source: string, plugins: ResolvedMarkdownPlugin[]) =>
  await parseComark(source, await resolveMarkdownPlugins(plugins))

const snapshotValue = (value: unknown): unknown => {
  if (typeof value === 'string' && value.length > 500) {
    return {
      length: value.length,
      sha256: createHash('sha256').update(value).digest('hex')
    }
  }
  if (Array.isArray(value)) return value.map(snapshotValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, snapshotValue(child)])
    )
  }
  return value
}

const errorContract = (error: unknown) => {
  const value = error as { name?: string; message?: string; issues?: Array<{ code?: string; path?: unknown[] }> }
  return {
    name: value?.name || 'Error',
    message: (value?.message || String(error)).replace(/[ \t]+$/gm, ''),
    issues: value?.issues?.map(issue => ({ code: issue.code, path: issue.path }))
  }
}

const statusOf = (value: { status: StageStatus }) => value.status

describe('Comark conformance corpus', () => {
  test.each(corpus)('$id names its profile and current support contract', (entry) => {
    expect(entry.profile).toMatch(/^(?:filesystem-configured|portable-baseline|inline-client-safe)$/)
    expect(entry.support).toMatch(/^(?:supported|known-gap|malformed)$/)
    expect(Object.keys(entry.expected)).toEqual(['raw', 'public', 'portable', 'ssr', 'agent'])
  })

  test.each(corpus)('$id freezes raw Comark 0.4 output separately', async (entry) => {
    const source = await readFixture(entry.fixture)
    try {
      const tree = await parseConfigured(source, entry.plugins)
      expect(entry.expected.raw).toBe('accepted')
      expect(snapshotValue({
        frontmatter: tree.frontmatter,
        meta: tree.meta,
        nodes: tree.nodes
      })).toMatchSnapshot(entry.id)
    }
    catch (error) {
      expect(entry.expected.raw).toBe('rejected')
      expect(errorContract(error)).toMatchSnapshot(entry.id)
    }
  })

  test.each(corpus)('$id freezes the Ginko pipeline contract', async (entry) => {
    const source = await readFixture(entry.fixture)
    let parsed: Awaited<ReturnType<typeof parseComark>> | undefined
    let rawStatus: StageStatus = 'accepted'
    try {
      parsed = await parseConfigured(source, entry.plugins)
    }
    catch {
      rawStatus = 'rejected'
    }

    const normalizedNodes = parsed
      ? normalizeComarkNodes(parsed.nodes as unknown[])
      : undefined
    const body = normalizedNodes
      ? toMarkdownRoot(normalizedNodes as Parameters<typeof toMarkdownRoot>[0])
      : undefined

    const publicResult = body
      ? validatePublicMarkdownAst(body, componentPolicy)
      : undefined
    const publicContract = publicResult
      ? publicResult.ok
        ? { status: 'accepted' as const }
        : {
            status: 'rejected' as const,
            issues: publicResult.issues.map(issue => ({ code: issue.code, path: issue.path }))
          }
      : { status: 'not-reached' as const }

    let portableContract: { status: StageStatus; nodes?: unknown; error?: unknown }
    try {
      const portable = await parsePortableMdc(source, componentPolicy)
      const serialized = await serializePortableMdc(portable, componentPolicy)
      const reparsed = await parsePortableMdc(serialized, componentPolicy)
      expect(reparsed.nodes).toEqual(portable.nodes)
      portableContract = { status: 'accepted', nodes: snapshotValue(portable.nodes) }
    }
    catch (error) {
      portableContract = { status: 'rejected', error: errorContract(error) }
    }

    let ssrContract: { status: StageStatus; html?: unknown; error?: unknown } = { status: 'not-reached' }
    let agentContract: { status: StageStatus; markdown?: unknown; error?: unknown } = { status: 'not-reached' }
    if (body) {
      try {
        const html = await renderToString(createSSRApp({
          render: () => h(MarkdownRenderer, {
            tree: body,
            prose: false,
            renderPolicy: componentPolicy
          })
        }))
        ssrContract = { status: 'accepted', html: snapshotValue(html) }
      }
      catch (error) {
        ssrContract = { status: 'rejected', error: errorContract(error) }
      }

      try {
        const markdown = renderAgentMarkdownBody(body, {
          collection: 'docs',
          page: { path: `/${entry.id}`, resolvedRefs: {} } as never,
          path: `/${entry.id}`,
          registry: createAgentMarkdownRegistry(),
          tagAliases: {},
          defaultLocale: 'en',
          locales: ['en']
        })
        agentContract = { status: 'accepted', markdown: snapshotValue(markdown) }
      }
      catch (error) {
        agentContract = { status: 'rejected', error: errorContract(error) }
      }
    }

    const actual = {
      raw: rawStatus,
      public: statusOf(publicContract),
      portable: statusOf(portableContract),
      ssr: statusOf(ssrContract),
      agent: statusOf(agentContract)
    }
    expect(actual).toEqual(entry.expected)
    expect(snapshotValue({
      normalizedNodes,
      public: publicContract,
      portable: portableContract,
      ssr: ssrContract,
      agent: agentContract
    })).toMatchSnapshot(entry.id)
  })
})
