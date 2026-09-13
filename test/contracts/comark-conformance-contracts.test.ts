import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, test } from 'vitest'
import { validatePublicMarkdownAst } from '../../packages/content/src/cms-contract/render-policy'
import { parseMdcBody, parseMdcDocument, projectMdcDocument, serializeMdcDocument } from '../../packages/content/src/cms-contract/mdc'
import type { PortableComponentPolicyV1 } from '../../packages/content/src/cms-contract/types'
import { createAgentMarkdownRegistry } from '../../packages/content/src/features/agent/agent-markdown'
import { renderAgentMarkdownBody } from '../../packages/content/src/features/agent/walker'
import { normalizeComarkNodes } from '../../packages/content/src/core/markdown/normalize-comark'
import { BUILTIN_MARKDOWN_RENDER_CONTRACTS } from '../../packages/content/src/core/markdown/builtin-render-contracts'
import { createComarkParser } from '../../packages/content/src/core/markdown/parse-comark'
import { toMarkdownRoot } from '../../packages/content/src/core/markdown/tree'
import markdownTransformer from '../../packages/content/src/parsers/markdown'
import { resolveMarkdownPlugins } from '../../packages/content/src/parsers/markdown-plugins'
import { parsePortableMdc, serializePortableMdc } from '../../packages/content/src/portability/mdc'
import MarkdownRenderer from '../../packages/content/src/runtime/app/components/internal/MarkdownRenderer'
import type { ResolvedMarkdownPlugin } from '../../packages/content/src/types/content'
import { Math as MathComponent } from '../../packages/content/node_modules/@comark/vue/dist/components/Math.js'
import { Mermaid as MermaidComponent } from '../../packages/content/node_modules/@comark/vue/dist/components/Mermaid.js'

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
    cms: StageStatus
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

const CalloutFixture = defineComponent({
  name: 'CalloutFixture',
  setup: (_, { slots }) => () => h('aside', { 'data-callout': 'true' }, [
    h('div', { 'data-slot': 'default' }, slots.default?.()),
    h('footer', { 'data-slot': 'actions' }, slots.actions?.()),
  ]),
})

const plugin = (name: string, options: Record<string, unknown> = {}): ResolvedMarkdownPlugin => ({
  name,
  options
})

const corpus: CorpusCase[] = [
  {
    id: 'basic',
    fixture: 'basic.md',
    profile: 'filesystem-configured',
    support: 'supported',
    plugins: [plugin('toc')],
    expected: { raw: 'accepted', cms: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'comments-summary',
    fixture: 'comments-summary.md',
    profile: 'filesystem-configured',
    support: 'supported',
    plugins: [plugin('summary')],
    expected: { raw: 'accepted', cms: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'components',
    fixture: 'components.md',
    profile: 'portable-baseline',
    support: 'supported',
    plugins: [],
    expected: { raw: 'accepted', cms: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'gfm',
    fixture: 'gfm.md',
    profile: 'portable-baseline',
    support: 'supported',
    plugins: [plugin('footnotes')],
    expected: { raw: 'accepted', cms: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'highlight',
    fixture: 'highlight.md',
    profile: 'filesystem-configured',
    support: 'supported',
    plugins: [plugin('shiki')],
    expected: { raw: 'accepted', cms: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'inline',
    fixture: 'inline.md',
    profile: 'inline-client-safe',
    support: 'supported',
    plugins: [],
    expected: { raw: 'accepted', cms: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'math',
    fixture: 'math.md',
    profile: 'filesystem-configured',
    support: 'known-gap',
    plugins: [plugin('math')],
    expected: { raw: 'accepted', cms: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'mermaid',
    fixture: 'mermaid.md',
    profile: 'filesystem-configured',
    support: 'supported',
    plugins: [plugin('mermaid')],
    expected: { raw: 'accepted', cms: 'accepted', public: 'accepted', portable: 'accepted', ssr: 'accepted', agent: 'accepted' }
  },
  {
    id: 'malformed',
    fixture: 'malformed.md',
    profile: 'portable-baseline',
    support: 'malformed',
    plugins: [],
    expected: { raw: 'rejected', cms: 'rejected', public: 'not-reached', portable: 'rejected', ssr: 'not-reached', agent: 'not-reached' }
  }
]

const fixturesRoot = resolve('test/fixtures/markdown-conformance')
const readFixture = (fixture: string) => readFile(resolve(fixturesRoot, fixture), 'utf8')
const parseConfigured = async (source: string, plugins: ResolvedMarkdownPlugin[]) =>
  await createComarkParser(await resolveMarkdownPlugins(plugins))(source)

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
    expect(Object.keys(entry.expected)).toEqual(['raw', 'cms', 'public', 'portable', 'ssr', 'agent'])
  })

  test.each(corpus)('$id freezes raw Comark 0.6 output separately', async (entry) => {
    const source = await readFixture(entry.fixture)
    let tree: Awaited<ReturnType<typeof parseConfigured>> | undefined
    try {
      tree = await parseConfigured(source, entry.plugins)
    }
    catch (error) {
      if (entry.expected.raw !== 'rejected') {
        throw error
      }
      expect(errorContract(error)).toMatchSnapshot(entry.id)
      return
    }

    expect(entry.expected.raw).toBe('accepted')
    expect(snapshotValue({
      frontmatter: tree.frontmatter,
      meta: tree.meta,
      nodes: tree.nodes
    })).toMatchSnapshot(entry.id)
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
      ? normalizeComarkNodes(parsed.nodes as unknown[], { enabledPlugins: entry.plugins.map(plugin => plugin.name) })
      : undefined
    const body = normalizedNodes
      ? toMarkdownRoot(normalizedNodes)
      : undefined
    const renderPolicy: PortableComponentPolicyV1 = {
      components: {
        ...componentPolicy.components,
        ...Object.fromEntries(entry.plugins.flatMap((plugin) => {
          const contract = BUILTIN_MARKDOWN_RENDER_CONTRACTS[plugin.name as keyof typeof BUILTIN_MARKDOWN_RENDER_CONTRACTS]
          return contract ? [[contract.tag, contract.componentPolicy]] : []
        })),
      },
    }

    const publicResult = body
      ? validatePublicMarkdownAst(body, renderPolicy)
      : undefined
    const publicContract = publicResult
      ? publicResult.ok
        ? { status: 'accepted' as const }
        : {
            status: 'rejected' as const,
            issues: publicResult.issues.map(issue => ({ code: issue.code, path: issue.path }))
          }
      : { status: 'not-reached' as const }

    let cmsContract: { status: StageStatus; body?: unknown; toc?: unknown; searchText?: string; error?: unknown }
    try {
      const cms = await parseMdcBody(source)
      const validation = validatePublicMarkdownAst(cms.body, componentPolicy)
      if (!validation.ok) throw Object.assign(new Error('CMS baseline AST failed the public render policy.'), { issues: validation.issues })
      cmsContract = {
        status: 'accepted',
        body: snapshotValue(cms.body),
        toc: snapshotValue(cms.toc),
        searchText: cms.searchText,
      }
    }
    catch (error) {
      cmsContract = { status: 'rejected', error: errorContract(error) }
    }

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
            renderPolicy,
            components: {
              callout: CalloutFixture,
              'ginko-math': MathComponent,
              'ginko-mermaid': MermaidComponent
            },
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
      cms: statusOf(cmsContract),
      public: statusOf(publicContract),
      portable: statusOf(portableContract),
      ssr: statusOf(ssrContract),
      agent: statusOf(agentContract)
    }
    expect(actual).toEqual(entry.expected)
    expect(snapshotValue({
      normalizedNodes,
      cms: cmsContract,
      public: publicContract,
      portable: portableContract,
      ssr: ssrContract,
      agent: agentContract
    })).toMatchSnapshot(entry.id)
  })
})

describe('editor angle syntax baseline', () => {
  test('parses typed props, nested Markdown, slots, comments, and inline components', async () => {
    const document = await parseMdcDocument(await readFixture('editor-angle.md'), { autoClose: false })
    const info = document.nodes[1]

    expect(info?.[0]).toBe('info')
    expect(info?.[1]).toMatchObject({
      $: { block: 1, sourceName: 'info', syntax: 'angle' },
      count: 3,
      disabled: false,
      enabled: true,
      options: { mode: 'safe', retries: [0, 3] },
      zero: 0,
      label: 'false',
    })
    expect(JSON.stringify(info)).toContain('["strong",{},"strong text"]')
    expect(JSON.stringify(info)).toContain('["template",{"name":"actions","$":{"syntax":"angle"')
    expect(JSON.stringify(document.nodes)).toContain('["a",{"href":"/guide"},"Open guide"]')
    expect(JSON.stringify(document.nodes)).toContain('["pre",{"language":"md"}')
    expect(document.nodes).toEqual(expect.arrayContaining([[null, {}, ' before component '], [null, {}, ' after component ']]))
  })

  test('proves the existing colon profile keeps typed values and nested Markdown', async () => {
    const document = await parseMdcDocument(await readFixture('editor-colon.md'), { autoClose: false })
    const info = document.nodes[1]

    expect(info?.[0]).toBe('info')
    expect(info?.[1]).toMatchObject({
      asset: '/ginko-assets/example.png',
      count: 3,
      disabled: false,
      enabled: true,
      label: 'false',
      options: { mode: 'safe', retries: [0, 3] },
      zero: 0,
    })
    expect(JSON.stringify(info)).toContain('["strong",{},"strong text"]')
    expect(document.nodes).toEqual(expect.arrayContaining([[null, {}, ' after component ']]))
  })

  test('reports strict incomplete input and keeps interactive completion derived-only', async () => {
    const source = await readFixture('editor-angle-incomplete.md')
    await expect(parseMdcDocument(source, { autoClose: false })).rejects.toMatchObject({
      name: 'AngleComponentSyntaxError',
      code: 'unclosed_tag',
      line: 1,
      column: 1,
    })
    const interactive = await parseMdcDocument(source)

    expect(interactive.nodes[0]?.[0]).toBe('info')
    expect(interactive.nodes[0]?.[1]).toMatchObject({ count: 3 })
  })

  test('preserves angle and colon origins across semantic round trips', async () => {
    const document = await parseMdcDocument(await readFixture('editor-angle.md'), { autoClose: false })
    const serialized = await serializeMdcDocument(document)
    const reparsed = await parseMdcDocument(serialized, { autoClose: false })

    expect(reparsed.nodes).toEqual(document.nodes)
    expect(serialized).toContain('<info')
    expect(serialized).toContain('<template #actions>')

    const colon = await parseMdcDocument(await readFixture('editor-colon.md'), { autoClose: false })
    expect(await serializeMdcDocument(colon)).toContain('::info')
  })

  test('rejects duplicate props, invalid JSON, and mismatched tags with typed diagnostics', async () => {
    await expect(parseMdcDocument(await readFixture('editor-angle-duplicate-prop.md'), { autoClose: false }))
      .rejects.toMatchObject({ code: 'duplicate_prop', line: 1, column: 1 })
    await expect(parseMdcDocument(await readFixture('editor-angle-invalid-json.md'), { autoClose: false }))
      .rejects.toMatchObject({ code: 'invalid_binding', line: 1, column: 1 })
    await expect(parseMdcDocument(await readFixture('editor-angle-mismatched.md'), { autoClose: false }))
      .rejects.toMatchObject({ code: 'mismatched_tag', openingTag: '<layout>' })
  })

  test('decodes quoted attributes once and retains the semantic component marker', async () => {
    const source = await readFixture('editor-angle-attributes.md')
    const document = await parseMdcDocument(source, { autoClose: false })
    expect(document.nodes[0]?.[1]).toMatchObject({
      featured: true,
      label: '',
      title: 'A > B & C',
      showLinkIcon: 'true',
      count: 3,
      options: { quote: 'go > now', entity: '&' },
    })
    const normalized = await parseMdcBody(source, { autoClose: false })
    expect(normalized.body.children[0]?.props?.$).toEqual({ component: 1, block: 1 })
  })

  test('keeps lowercase HTML native and PascalCase collisions explicitly component-owned', async () => {
    const parsed = await parseMdcBody(await readFixture('editor-angle-collisions.md'), { autoClose: false })
    const nativeFigure = parsed.body.children.find(node => node.type === 'element' && node.tag === 'figure' && node.props?.$?.html === 1)
    const componentFigure = parsed.body.children.find(node => node.type === 'element' && node.tag === 'figure' && node.props?.$?.component === 1)
    expect(nativeFigure).toBeTruthy()
    expect(componentFigure?.props?.$).toEqual({ component: 1, block: 1 })

    const figurePolicy: PortableComponentPolicyV1 = {
      components: {
        figure: {
          kind: 'block',
          props: {
            src: { type: 'asset', required: false },
            alt: { type: 'string', required: false },
          },
          slots: ['default'],
          media: null,
        },
      },
    }
    expect(validatePublicMarkdownAst({ type: 'root', children: [nativeFigure] }, figurePolicy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst({ type: 'root', children: [componentFigure] }, figurePolicy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst({ type: 'root', children: [componentFigure] }, { components: {} })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unknown_component' })]),
    })
  })

  test('parses components in containers while leaving code forms literal', async () => {
    const document = await parseMdcDocument(await readFixture('editor-angle-containers.md'), { autoClose: false })
    const serialized = JSON.stringify(document.nodes)
    const listComponent = document.nodes[0]?.[2]?.[3]
    expect(listComponent?.[1]).toMatchObject({ $: { syntax: 'angle', block: 1, sourceName: 'info' } })
    expect(serialized).toContain('Component in a')
    expect(serialized).toContain('Nested same-name component')
    expect(serialized).toContain('<info>indented code stays literal</info>')
    expect(serialized).toContain('<info>fenced code stays literal</info>')
  })

  test('keeps escaped and entity-encoded component delimiters literal', async () => {
    const document = await parseMdcDocument(String.raw`\<info>escaped\</info> and &lt;info&gt;encoded&lt;/info&gt;`, { autoClose: false })
    expect(JSON.stringify(document.nodes)).not.toContain('"syntax":"angle"')
    expect(JSON.stringify(document.nodes)).toContain('<info>escaped</info>')
    expect(JSON.stringify(document.nodes)).toContain('<info>encoded</info>')
  })

  test('leaves native HTML and CommonMark autolinks to their standard tokenizers', async () => {
    for (const source of [
      '<div class=test>hello</div>',
      '<https://example.com>',
      '<hello@example.com>',
    ]) {
      const document = await parseMdcDocument(source, { autoClose: false })
      expect(JSON.stringify(document.nodes)).not.toContain('"syntax":"angle"')
      expect(await serializeMdcDocument(document)).not.toBe('')
    }
  })

  test('ignores component-looking text in inline code, escapes, and comments while matching closes', async () => {
    const sources = [
      '<Badge>`<Other>`</Badge>',
      String.raw`<Badge>\<Other></Badge>`,
      '<Badge><!-- <Other> -->hello</Badge>',
      '<Badge><span title="<Other>">hello</span></Badge>',
    ]
    for (const source of sources) {
      const document = await parseMdcDocument(source, { autoClose: false })
      const serialized = await serializeMdcDocument(document)
      await expect(parseMdcDocument(serialized, { autoClose: false })).resolves.toBeTruthy()
      expect(JSON.stringify(document.nodes).match(/"syntax":"angle"/g)).toHaveLength(1)
    }
  })

  test('keeps link and image titles out of inline component close matching', async () => {
    for (const title of ['close </Badge> text', 'open <Other> text']) {
      for (const prefix of ['', '!']) {
        const source = `<Badge>${prefix}[x](/x "${title}") after</Badge>`
        const document = await parseMdcDocument(source, { autoClose: false })
        const badge = document.nodes[0]?.[2]
        expect(badge?.[0]).toBe('badge')
        expect(badge?.[2]?.[1]).toMatchObject({ title })
        expect(badge?.[3]).toBe(' after')
        const serialized = await serializeMdcDocument(document)
        const reparsed = await parseMdcDocument(serialized, { autoClose: false })
        expect(projectMdcDocument(reparsed).body).toEqual(projectMdcDocument(document).body)
      }
    }
    const nested = await parseMdcDocument('<Badge>[<Inner>label</Inner>](/x "</Badge>") after</Badge>', { autoClose: false })
    expect(JSON.stringify(nested.nodes).match(/"syntax":"angle"/g)).toHaveLength(2)
  })

  test('honors complete CommonMark fence closers before scanning block component closes', async () => {
    const source = '<Info>\n````md\n```\n</Info>\n````\n</Info>'
    const document = await parseMdcDocument(source, { autoClose: false })
    const info = document.nodes[0]
    expect(info?.[0]).toBe('info')
    expect(info?.[2]).toEqual(['pre', { language: 'md' }, ['code', { class: 'language-md' }, '```\n</Info>']])
    expect(document.nodes).toHaveLength(1)

    const tildeSource = '<Info>\n~~~~ md\n</Info>\n~~~~ trailing\n</Info>\n   ~~~~\n</Info>'
    const tildeDocument = await parseMdcDocument(tildeSource, { autoClose: false })
    expect(JSON.stringify(tildeDocument.nodes[0]?.[2])).toContain('</Info>\\n~~~~ trailing\\n</Info>')
    expect(tildeDocument.nodes).toHaveLength(1)
  })

  test('uses Markdown code precedence while finding block component closes', async () => {
    const fenced = await parseMdcDocument('<Info>\n```html\n<!-- a comment example\n```\nAfter code\n</Info>', { autoClose: false })
    expect(fenced.nodes).toEqual([[
      'info',
      { $: { syntax: 'angle', block: 1, sourceName: 'Info' } },
      ['pre', { language: 'html' }, ['code', { class: 'language-html' }, '<!-- a comment example']],
      ['p', {}, 'After code'],
    ]])

    const inline = await parseMdcDocument('<Info>\nBefore `literal\n</Info>\ntext` after\n</Info>', { autoClose: false })
    expect(inline.nodes).toEqual([[
      'info',
      { $: { syntax: 'angle', block: 1, sourceName: 'Info' } },
      'Before ',
      ['code', {}, 'literal </Info> text'],
      ' after',
    ]])

    const quotedProp = await parseMdcDocument('<Info label="`">\nContent\n</Info>\n`', { autoClose: false })
    expect(quotedProp.nodes[0]).toEqual([
      'info',
      { label: '`', $: { syntax: 'angle', block: 1, sourceName: 'Info' } },
      'Content',
    ])

    const heading = await parseMdcDocument('<Info>\n# Heading `literal\n</Info>\n`', { autoClose: false })
    expect(heading.nodes).toEqual([
      [
        'info',
        { $: { syntax: 'angle', block: 1, sourceName: 'Info' } },
        ['h1', { id: 'heading-literal' }, 'Heading `literal'],
      ],
      ['p', {}, '`'],
    ])
  })

  test('combines nested components, multiline code, and native inline HTML contexts', async () => {
    const sameName = await parseMdcDocument('<Info>\n<Info>\nBefore `literal\n</Info>\ntext` after\n</Info>\n</Info>', { autoClose: false })
    expect(sameName.nodes).toEqual([[
      'info',
      { $: { syntax: 'angle', block: 1, sourceName: 'Info' } },
      [
        'info',
        { $: { syntax: 'angle', block: 1, sourceName: 'Info' } },
        'Before ',
        ['code', {}, 'literal </Info> text'],
        ' after',
      ],
    ]])

    const mixedNames = await parseMdcDocument('<Layout>\n<Column>\nBefore `literal\n</Column>\ntext` after\n</Column>\n</Layout>', { autoClose: false })
    expect(mixedNames.nodes).toEqual([[
      'layout',
      { $: { syntax: 'angle', block: 1, sourceName: 'Layout' } },
      [
        'column',
        { $: { syntax: 'angle', block: 1, sourceName: 'Column' } },
        'Before ',
        ['code', {}, 'literal </Column> text'],
        ' after',
      ],
    ]])

    const native = await parseMdcDocument(`<Info>\n${'😀'.repeat(10)} Before <span title="\`">text</span> and \`literal\n</Info>\ntext\` after\n</Info>`, { autoClose: false })
    expect(native.nodes[0]).toEqual([
      'info',
      { $: { syntax: 'angle', block: 1, sourceName: 'Info' } },
      `${'😀'.repeat(10)} Before `,
      ['span', { title: '`', $: { html: 1, block: 0 } }, 'text'],
      ' and ',
      ['code', {}, 'literal </Info> text'],
      ' after',
    ])

    for (const document of [sameName, mixedNames, native]) {
      const serialized = await serializeMdcDocument(document)
      await expect(parseMdcDocument(serialized, { autoClose: false })).resolves.toEqual(document)
    }
  })

  test.each([
    '<Alert title="',
    '<Alert title="unfinished',
    '<Alert title=',
    '<Alert :title',
    '<Alert :',
    '<Alert /',
    'Before <Badge title="',
    'Before <Badge>nested <Inner title="',
    '<Layout>\n<template #',
  ])('accepts recoverable incomplete preview input but rejects persistence: %s', async (source) => {
    await expect(parseMdcDocument(source)).resolves.toBeDefined()
    await expect(parseMdcDocument(source, { autoClose: false })).rejects.toThrow()
  })

  test.each([{ plugins: [] }, { plugins: [plugin('toc')] }])('keeps filesystem ingestion strict with plugins $plugins', async ({ plugins }) => {
    await expect(markdownTransformer.parse!('page.md', '<Alert>\nIncomplete', { plugins })).rejects.toMatchObject({ name: 'AngleComponentSyntaxError' })
    await expect(markdownTransformer.parse!('page.md', '<Alert title="', { plugins })).rejects.toMatchObject({ name: 'AngleComponentSyntaxError' })
    await expect(markdownTransformer.parse!('page.md', '<Alert>\nComplete\n</Alert>', { plugins })).resolves.toMatchObject({ type: 'markdown' })
  })

  test.each([250, 500, 1_000, 2_000])('handles %i ordinary paragraphs without per-line context rescans', async (lines) => {
    const body = Array.from({ length: lines }, (_, index) => `ordinary paragraph ${index}`).join('\n\n')
    let visitedLines = 0
    const parse = createComarkParser([{
      name: 'measure-block-work',
      markdownItPlugins: [(markdown) => {
        const tokenize = markdown.block.tokenize.bind(markdown.block)
        markdown.block.tokenize = (state, startLine, endLine) => {
          visitedLines += endLine - startLine
          return tokenize(state, startLine, endLine)
        }
      }],
    }], { autoClose: false })
    const document = await parse(`<Info>\n${body}\n</Info>`)
    expect(document.nodes).toHaveLength(1)
    expect(JSON.stringify(document.nodes)).toContain(`ordinary paragraph ${lines - 1}`)
    // Count total analyzed ranges: repeated suffix scans preserve the AST but
    // make this grow quadratically. Leave room for a fixed number of passes.
    expect(visitedLines).toBeLessThanOrEqual(8 * lines)
  })

  test('preserves significant inline whitespace through serialization', async () => {
    const source = 'Before <Badge>hello </Badge>after'
    const document = await parseMdcDocument(source, { autoClose: false })
    const serialized = await serializeMdcDocument(document)
    expect(serialized).toContain('<Badge>hello </Badge>after')
    expect(await parseMdcDocument(serialized, { autoClose: false })).toEqual(document)
  })

  test('rejects orphan, partial, misplaced, duplicate, and mixed-default angle structure with source locations', async () => {
    await expect(parseMdcDocument('First\n\n</Info>', { autoClose: false }))
      .rejects.toMatchObject({ code: 'orphan_close', line: 3, column: 1 })
    await expect(parseMdcDocument('First\n\nBefore <Badge', { autoClose: false }))
      .rejects.toMatchObject({ code: 'invalid_prop', line: 3, column: 8 })
    await expect(parseMdcDocument('First\n\nBefore </Badge', { autoClose: false }))
      .rejects.toMatchObject({ code: 'invalid_prop', line: 3, column: 8 })
    await expect(parseMdcDocument('> Before <Badge', { autoClose: false }))
      .rejects.toMatchObject({ code: 'invalid_prop', line: 1, column: 10 })
    await expect(parseMdcDocument('<template #actions>\nhello\n</template>', { autoClose: false }))
      .rejects.toMatchObject({ code: 'misplaced_slot', line: 1, column: 1 })
    await expect(parseMdcDocument('<Info>\n<template #actions>\none\n</template>\n<template #actions>\ntwo\n</template>\n</Info>', { autoClose: false }))
      .rejects.toMatchObject({ code: 'duplicate_slot', line: 5, column: 1 })
    await expect(parseMdcDocument(await readFixture('editor-angle-ambiguous-default-slot.md'), { autoClose: false }))
      .rejects.toMatchObject({ code: 'mixed_default_slot', line: 1, column: 1 })
  })
})
