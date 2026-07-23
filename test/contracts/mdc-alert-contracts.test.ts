import { describe, expect, it } from 'vitest'

import { parseMdcBody, validatePublicMarkdownAst } from '../../packages/content/src/cms-contract'
import { createAgentMarkdownRegistry } from '../../packages/content/src/features/agent/agent-markdown'
import { renderAgentMarkdownBody } from '../../packages/content/src/features/agent/walker'

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
  it('restores top-level YAML booleans without changing structured JSON values', async () => {
    const { body } = await parseMdcBody(`::quiz-question
---
active: true
options:
  - text: Ginko Content
    correct: true
  - text: Ginko Docs
    correct: false
---
Explanation.
::`)

    expect(body.children[0]).toMatchObject({
      tag: 'quiz-question',
      props: {
        active: true,
        options: [
          { text: 'Ginko Content', correct: true },
          { text: 'Ginko Docs', correct: false },
        ],
      },
    })
  })

  it('leaves inline Vue bindings unsafe', async () => {
    const { body } = await parseMdcBody('::quiz-question{:active="true"}\nExplanation.\n::')

    expect(body.children[0]).toMatchObject({ props: { ':active': 'true' } })
    expect(validatePublicMarkdownAst(body, {
      components: {
        'quiz-question': {
          kind: 'block',
          props: { active: { type: 'boolean', required: false } },
          slots: [],
          media: null,
        },
      },
    })).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_prop' })],
    })
  })
})
