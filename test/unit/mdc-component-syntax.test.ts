import { describe, expect, it } from 'vitest'
import { parseMdcDocument, projectMdcDocument, serializeMdcDocument, type MdcDocument } from '../../packages/content/src/cms-contract'

const document = (nodes: MdcDocument['nodes']): MdcDocument => ({ nodes, frontmatter: {}, meta: {} })

describe('component syntax for new and stored nodes', () => {
  it('writes new components with angle syntax by default and permits an explicit colon default', async () => {
    const value = document([['callout', { title: 'Context', shown: false }, 'Body']])
    expect(await serializeMdcDocument(value)).toBe('<Callout title="Context" :shown="false">\nBody\n</Callout>')
    expect(await serializeMdcDocument(value, { componentSyntax: 'colon' })).toMatch(/^::callout/)
    expect(value.nodes[0]).toEqual(['callout', { title: 'Context', shown: false }, 'Body'])
  })

  it.each(['colon', 'angle'] as const)('keeps stored colon and angle forms when the new-node default is %s', async (componentSyntax) => {
    for (const source of ['::note\nBody\n::', '<Note>\nBody\n</Note>', 'Before :badge[Text] after', 'Before <Badge>Text</Badge> after']) {
      const parsed = await parseMdcDocument(source, { autoClose: false })
      expect(await serializeMdcDocument(parsed, { componentSyntax })).toBe(source)
    }
  })
})

describe('multiline component opening tags', () => {
  it.each([
    '<Card\n title="A > B"\n :count="3"\n>\nBody\n</Card>',
    '> <Card\n> title="A > B"\n> :count="3"\n> >\n> Body\n> </Card>',
    '- <Card\n  title="A > B"\n  :count="3"\n  >\n  Body\n  </Card>',
  ])('reads typed properties within their Markdown container: %s', async (source) => {
    const parsed = await parseMdcDocument(source, { autoClose: false })
    const body = projectMdcDocument(parsed).body
    expect(JSON.stringify(body)).toContain('"title":"A > B","count":3')
    const serialized = await serializeMdcDocument(parsed)
    expect(projectMdcDocument(await parseMdcDocument(serialized, { autoClose: false })).body).toEqual(body)
  })

  it('keeps whitespace and tag-like text inside a multiline quoted value', async () => {
    const source = '<Card\n title="First\n   </Card>\nLast"\n>\nBody\n</Card>'
    const parsed = await parseMdcDocument(source, { autoClose: false })
    expect(parsed.nodes[0]).toMatchObject(['card', { title: 'First\n   </Card>\nLast' }, 'Body'])
    expect(projectMdcDocument(await parseMdcDocument(await serializeMdcDocument(parsed), { autoClose: false })).body).toEqual(projectMdcDocument(parsed).body)
  })

  it('ends a self-closing tag before following sibling content', async () => {
    const parsed = await parseMdcDocument('<Figure\n src="/photo.png"\n alt="Canopy"\n/>\n\nAfter', { autoClose: false })
    expect(parsed.nodes).toMatchObject([
      ['figure', { src: '/photo.png', alt: 'Canopy', $: { syntax: 'angle', block: 1 } }],
      ['p', {}, 'After'],
    ])
  })

  it('finds nested openings and named slots across lines without reading fenced code as tags', async () => {
    const source = '<Card\n title="Outer"\n>\n<template\n #title\n>\nHeading\n</template>\n<Note\n title="Inner"\n>\n```html\n</Note>\n```\n</Note>\n</Card>'
    const parsed = await parseMdcDocument(source, { autoClose: false })
    expect(parsed.nodes).toMatchObject([
      ['card', { title: 'Outer' }, ['template', { name: 'title' }, 'Heading'], ['note', { title: 'Inner' }, ['pre', { language: 'html' }, ['code', { class: 'language-html' }, '</Note>']]]],
    ])
    const serialized = await serializeMdcDocument(parsed)
    expect(projectMdcDocument(await parseMdcDocument(serialized, { autoClose: false })).body).toEqual(projectMdcDocument(parsed).body)
  })

  it.each([
    '> <Card\n> title="A"\n\nOutside />\n\nAfter',
    '- > <Card\n  > title="A"\n\n  Outside />\n\nAfter',
  ])('does not consume a sibling beyond an incomplete tag container: %s', async (source) => {
    await expect(parseMdcDocument(source, { autoClose: false })).rejects.toMatchObject({ code: 'invalid_prop' })
    const parsed = await parseMdcDocument(source, { autoClose: true })
    expect(JSON.stringify(parsed.nodes)).toContain('Outside />')
    expect(JSON.stringify(parsed.nodes)).toContain('After')
    expect(JSON.stringify(parsed.nodes)).not.toContain('"Outside":true')
  })

  it('keeps malformed multiline bindings invalid with the opening location', async () => {
    await expect(parseMdcDocument('Before\n\n<Card\n :count="not-json"\n/>', { autoClose: false })).rejects.toMatchObject({ code: 'invalid_binding', line: 3 })
  })
})
