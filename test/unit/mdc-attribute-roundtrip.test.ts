import { describe, expect, it } from 'vitest'
import { parseMdcDocument, projectMdcDocument, serializeMdcDocument } from '../../packages/content/src/cms-contract/mdc'

describe('edited colon component properties', () => {
  it.each([0, true, false, null, 'first\nsecond', 'C:\\folder\\', 'She said "hello"', 'Both "hello" and \'goodbye\'', 'All "double", \'single\', and `backtick` quotes', '', 'a}b[c]&<tag>', { label: 'She said "hello"', values: [1, false] }])('preserves %j', async (value) => {
    const document = await parseMdcDocument('Hello :badge[world]{title="Before"}')
    const paragraph = document.nodes[0]
    if (typeof paragraph === 'string' || !paragraph || paragraph[0] !== 'p') throw new Error('Missing paragraph')
    const badge = paragraph[3]
    if (typeof badge === 'string' || !badge || badge[0] !== 'badge') throw new Error('Missing badge')
    badge[1].title = value
    const expected = projectMdcDocument(document).body
    const serialized = await serializeMdcDocument(document)
    const parsed = await parseMdcDocument(serialized, { autoClose: false })
    expect(projectMdcDocument(parsed).body).toEqual(expected)
  })
})


describe('colon components with native element names', () => {
  it.each(['img', 'span', 'table', 'a', 'p'])('preserves %s component identity and props', async (name) => {
    const document = await parseMdcDocument(`::${name}{source="asset_123"}\nHello\n::`, { autoClose: false })
    const before = structuredClone(document)
    const serialized = await serializeMdcDocument(document)
    const reparsed = await parseMdcDocument(serialized, { autoClose: false })
    expect(projectMdcDocument(reparsed).body).toEqual(projectMdcDocument(document).body)
    expect(serialized).toContain('::')
    expect(document).toEqual(before)
  })
})
