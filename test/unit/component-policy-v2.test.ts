import { describe, expect, it } from 'vitest'

import {
  assertResolvedContentContractV1,
  assertResolvedContentContractV2,
  buildResolvedContentContract,
  classifyPortableMarkdownElement,
  parseMdcDocument,
  projectMdcDocument,
  serializeMdcDocument,
  validatePublicMarkdownAst,
  validateStoredPortableMarkdownAst,
  type PortableComponentPolicyV2,
} from '../../packages/content/src/cms-contract'
import { rebuildPortableManifest } from '../../packages/content/src/portability'

const policy = {
  version: 2,
  components: {
    panel: {
      kind: 'block',
      props: {},
      slots: ['default'],
      allowedParents: null,
      allowedChildren: ['note'],
      media: null,
    },
    note: {
      kind: 'block',
      props: {
        tone: { types: ['string'], required: true, allowedValues: ['info', 'warning'] },
        value: { types: ['boolean', 'string', 'json'], required: false, allowedValues: [true, 'auto'] },
      },
      slots: ['default'],
      allowedParents: ['panel'],
      allowedChildren: null,
      media: null,
    },
  },
} as const satisfies PortableComponentPolicyV2

const root = (children: unknown[]) => ({ type: 'root', children })
const element = (tag: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({
  type: 'element', tag, props, children,
})

describe('portable component policy v2', () => {
  it('normalizes only in the builder and keeps strict readers non-mutating', () => {
    const input = structuredClone({
      ...policy,
      components: {
        ...policy.components,
        note: {
          ...policy.components.note,
          props: {
            ...policy.components.note.props,
            value: { types: ['json', 'string', 'boolean'], required: false, allowedValues: ['auto', true] },
          },
        },
      },
    }) as PortableComponentPolicyV2
    const before = structuredClone(input)
    const contract = buildResolvedContentContract({ collections: { docs: { type: 'page' } } }, {
      defaultLocale: 'en', locales: ['en'], componentPolicy: input,
    })

    expect(input).toEqual(before)
    expect(contract.version).toBe(2)
    expect(contract.collections.docs?.componentPolicy.components.note?.props.value?.types)
      .toEqual(['string', 'boolean', 'json'])
    const snapshot = structuredClone(contract)
    expect(assertResolvedContentContractV2(contract)).toBe(contract)
    expect(contract).toEqual(snapshot)
    expect(() => assertResolvedContentContractV1(contract)).toThrow(/version 1/)

    const noncanonical = structuredClone(contract)
    noncanonical.collections.docs!.componentPolicy.components.note!.props.value!.types = ['json', 'string', 'boolean']
    const noncanonicalBefore = structuredClone(noncanonical)
    expect(() => assertResolvedContentContractV2(noncanonical)).toThrow(/not canonical/)
    expect(noncanonical).toEqual(noncanonicalBefore)
  })

  it('enforces value unions, literals, required props, and both nesting directions', () => {
    const valid = root([element('panel', {}, [
      element('note', { tone: 'info', value: { nested: [1, true, null] } }),
    ])])
    expect(validatePublicMarkdownAst(valid, policy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root([element('note', { tone: 'other' })]), policy)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_prop_value' }),
        expect.objectContaining({ code: 'invalid_nesting' }),
      ]),
    })
    expect(validatePublicMarkdownAst(root([element('panel')]), {
      ...policy,
      components: {
        ...policy.components,
        panel: { ...policy.components.panel, allowedChildren: ['note'] },
      },
    })).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root([element('panel', {}, [element('unknown')])]), policy)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unknown_component' })]),
    })
    expect(validatePublicMarkdownAst(root([element('note')]), policy)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'missing_prop' })]),
    })
  })

  it('separates stored asset identities from public renderer input', () => {
    const storedImage = root([element('img', { src: 'asset_123', alt: 'Example' })])
    expect(validateStoredPortableMarkdownAst(storedImage, policy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(storedImage, policy)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unsafe_url' })]),
    })
    for (const source of ['javascript:alert(1)', 'data:text/html,boom']) {
      const unsafe = root([element('img', { src: source })])
      expect(validateStoredPortableMarkdownAst(unsafe, policy)).toMatchObject({ ok: false })
      expect(validatePublicMarkdownAst(unsafe, policy)).toMatchObject({ ok: false })
    }
  })

  it('projects a parsed document without modifying editing nodes', async () => {
    const document = await parseMdcDocument('## Heading\n\n::panel\nText\n::', { autoClose: false })
    const before = structuredClone(document)
    const projection = projectMdcDocument(document)
    expect(projection.searchText).toContain('Heading')
    expect(document).toEqual(before)
  })

  it('keeps named slots attached to their direct component parent', () => {
    const namedSlot = element('template', { name: 'tip' }, [element('p', {}, [{ type: 'text', value: 'Lost' }])])
    const direct = root([element('panel', {}, [namedSlot])])
    const wrapped = root([element('panel', {}, [element('div', {}, [namedSlot])])])
    const slotPolicy: PortableComponentPolicyV2 = {
      ...policy,
      components: {
        panel: { ...policy.components.panel, slots: ['default', 'tip'] },
      },
    }

    expect(validatePublicMarkdownAst(direct, slotPolicy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(wrapped, slotPolicy)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unsafe_tag' })]),
    })
  })

  it('classifies parsed colon components with their authored form', async () => {
    const document = await parseMdcDocument('hello :badge[world]', { autoClose: false })
    const projected = projectMdcDocument(document)
    const badge = projected.body.children[0]?.children?.[1]
    expect(badge).toBeDefined()
    if (!badge) throw new Error('Expected a parsed inline badge.')

    expect(classifyPortableMarkdownElement(badge, {
      version: 2,
      components: {
        badge: { ...policy.components.panel, kind: 'inline' },
      },
    })).toMatchObject({ kind: 'component', form: 'inline' })

    expect(validateStoredPortableMarkdownAst(projected.body, {
      version: 2,
      components: {
        badge: { ...policy.components.panel, kind: 'block' },
      },
    })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid_node' })]),
    })
  })

  it.each([
    ':badge[world]{tone="quiet"}',
    ':badge[world]{s="A & B"}',
    ':badge[world]{s="A &amp; B &quot;quoted&quot;"}',
    ':badge[hello \\] world]',
    ':badge[**bold** and _italic_ and `code`]',
    ':badge[outer :badge[inner]]',
    'before :badge[one] after :badge[two].',
    ':badge{tone="quiet"}',
    'before :badge{tone="quiet"} after',
    'hello :badge[world]',
    '::panel{tone="quiet"}\nBody\n::',
    '::panel\n#tip\nTip\n::',
    '::panel\nText :badge[hello]\n::',
  ])('round-trips authored colon form: %s', async (source) => {
    const document = await parseMdcDocument(source, { autoClose: false })
    const serialized = await serializeMdcDocument(document)
    const reparsed = await parseMdcDocument(serialized, { autoClose: false })
    expect(projectMdcDocument(reparsed).body, `Serialized: ${serialized}`).toEqual(
      projectMdcDocument(document).body,
    )
  })

  it('rejects non-finite allowed values before emitting a V2 contract', () => {
    const invalid: PortableComponentPolicyV2 = {
      version: 2,
      components: {
        panel: {
          ...policy.components.panel,
          props: {
            tone: { types: ['number'], required: false, allowedValues: [Infinity] },
          },
        },
      },
    }
    expect(() => buildResolvedContentContract(
      { collections: { docs: { type: 'page' } } },
      { defaultLocale: 'en', locales: ['en'], componentPolicy: invalid },
    )).toThrow()
  })

  it('emits a V2 portability manifest for a V2 contract', async () => {
    const contract = buildResolvedContentContract(
      { collections: { docs: { type: 'page' } } },
      { defaultLocale: 'en', locales: ['en'], componentPolicy: policy },
    )
    await expect(
      rebuildPortableManifest({ contract, documents: [], assets: [] }),
    ).resolves.toMatchObject({ format: 'ginko-content-portable', version: 2 })
  })
})
