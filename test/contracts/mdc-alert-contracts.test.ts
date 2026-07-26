import { describe, expect, it } from 'vitest'

import { parseMdcBody, validatePublicMarkdownAst } from '../../packages/content/src/cms-contract'
import { createAgentMarkdownRegistry } from '../../packages/content/src/features/agent/agent-markdown'
import { renderAgentMarkdownBody } from '../../packages/content/src/features/agent/walker'
import { parsePortableMdc } from '../../packages/content/src/portability'
import { transformContent } from '../../packages/content/src/parsers'

describe('GFM alert contract', () => {
  it.each(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) (
    'normalizes %s into inert blockquote metadata',
    async (kind) => {
      const { body } = await parseMdcBody(`> [!${kind}]\n> Portable alert.`)

      expect(body.children[0]).toMatchObject({
        type: 'element',
        tag: 'blockquote',
        props: { 'data-alert': kind.toLowerCase() },
      })
      expect(validatePublicMarkdownAst(body)).toMatchObject({ ok: true })
    },
  )

  it('does not normalize arbitrary authored structural metadata', async () => {
    const { body } = await parseMdcBody('::blockquote{as="dialog"}\nPlain quote.\n::')

    expect(validatePublicMarkdownAst(body)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_prop' })],
    })
  })

  it('preserves normalized alerts in agent-facing Markdown', async () => {
    const { body } = await parseMdcBody('> [!WARNING]\n> Check the path.')

    expect(renderAgentMarkdownBody(body, {
      collection: 'docs',
      page: { body } as never,
      path: '/docs/alerts',
      locale: 'en',
      registry: createAgentMarkdownRegistry(),
      tagAliases: {},
      defaultLocale: 'en',
      locales: ['en'],
    })).toBe('> [!WARNING]\n> Check the path.')
  })
})

describe('Comark component frontmatter contract', () => {
  const policy = {
    components: {
      'quiz-question': {
        kind: 'block' as const,
        props: {
          active: { type: 'boolean' as const, required: false },
          count: { type: 'number' as const, required: false },
          label: { type: 'string' as const, required: false },
          quoted: { type: 'string' as const, required: false },
          options: { type: 'json' as const, required: false },
        },
        slots: [],
        media: null,
      },
    },
  }

  const frontmatterSource = `::quiz-question{label="inline"}
---
active: true
count: 2
label: YAML wins
quoted: "false"
options:
  - text: Ginko Content
    correct: true
  - text: Ginko Docs
    correct: false
---
Explanation.
::`

  it('restores typed component YAML at the parser-token boundary', async () => {
    const { body } = await parseMdcBody(frontmatterSource)

    expect(body.children[0]).toMatchObject({
      tag: 'quiz-question',
      props: {
        active: true,
        count: 2,
        label: 'YAML wins',
        quoted: 'false',
        options: [
          { text: 'Ginko Content', correct: true },
          { text: 'Ginko Docs', correct: false },
        ],
      },
    })
    expect(validatePublicMarkdownAst(body, policy)).toMatchObject({ ok: true })
  })

  it('preserves false as a boolean and nested component provenance', async () => {
    const { body } = await parseMdcBody(`::::wrapper
::quiz-question
---
active: false
---
::
::::`)

    expect(body.children[0]).toMatchObject({
      tag: 'wrapper',
      children: [
        expect.objectContaining({
          tag: 'quiz-question',
          props: { active: false },
        }),
      ],
    })
  })

  it('leaves inline Vue bindings unsafe', async () => {
    const { body } = await parseMdcBody('::quiz-question{:active="true"}\nExplanation.\n::')

    expect(body.children[0]).toMatchObject({ props: { ':active': 'true' } })
    expect(validatePublicMarkdownAst(body, policy)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_prop' })],
    })
  })

  it('cannot be desynchronized by indented, fenced, or malformed component-like text', async () => {
    const source = `    ::quiz-question
---
active: true
---
::

Not a component opener: ::quiz-question
---
active: true
---
::

\`\`\`mdc
::quiz-question
---
active: true
---
::
\`\`\`

::quiz-question{:active="true"}
Real.
::`
    const { body } = await parseMdcBody(source)
    const real = body.children.find(node => node.type === 'element' && node.tag === 'quiz-question')

    expect(real).toMatchObject({ props: { ':active': 'true' } })
    expect(validatePublicMarkdownAst(body, policy)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_prop' })],
    })
  })

  it('uses the same typed component parser in CMS, portability, and filesystem ingestion', async () => {
    const cms = await parseMdcBody(frontmatterSource)
    const portable = await parsePortableMdc(frontmatterSource, policy)
    const filesystem = await transformContent('content:quiz.md', frontmatterSource) as {
      body: { children: Array<{ props?: Record<string, unknown> }> }
    }

    const expected = {
      active: true,
      count: 2,
      label: 'YAML wins',
      quoted: 'false',
      options: [
        { text: 'Ginko Content', correct: true },
        { text: 'Ginko Docs', correct: false },
      ],
    }
    expect(cms.body.children[0]).toMatchObject({ props: expected })
    expect(portable.nodes[0]?.[0]).toBe('quiz-question')
    expect(portable.nodes[0]?.[1]).toMatchObject(expected)
    expect(filesystem.body.children[0]).toMatchObject({ props: expected })
  })
})
