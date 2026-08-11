import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import {
  isSafePublicMarkdownUrl,
  validatePublicMarkdownAst,
  type PortableComponentPolicyV1,
} from '../../packages/content/src/cms-contract'
import MarkdownRenderer from '../../packages/content/src/runtime/app/components/internal/MarkdownRenderer'
import { normalizeComarkNodes } from '../../packages/content/src/core/markdown/normalize-comark'
import { withMarkdownPluginComponentPolicy } from '../../packages/content/src/module/markdown-plugin-templates'

const root = (node: Record<string, unknown>) => ({ type: 'root', children: [node] })
const element = (tag: string, props: Record<string, unknown> = {}) => ({
  type: 'element',
  tag,
  props,
  children: [],
})

describe('canonical public Markdown render policy', () => {
  it.each(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'])(
    'rejects the active <%s> context',
    (tag) => {
      expect(validatePublicMarkdownAst(root(element(tag)))).toMatchObject({
        ok: false,
        issues: [expect.objectContaining({ code: 'unsafe_tag', path: ['children', 0, 'tag'] })],
      })
    },
  )

  it.each(['onerror', 'onClick', 'innerHTML', 'textContent', 'is', 'as', '__proto__', 'v-html'])(
    'rejects the executable or structural property %s',
    (prop) => {
      const props = Object.create(null) as Record<string, unknown>
      Object.defineProperty(props, prop, { value: 'boom', enumerable: true })
      expect(validatePublicMarkdownAst(root(element('img', props)))).toMatchObject({
        ok: false,
        issues: [expect.objectContaining({ code: 'unsafe_prop' })],
      })
    },
  )

  it.each(['javascript:alert(1)', 'data:text/html,boom', 'blob:https://example.test/id', '//evil.test/x', '/\\evil.test/x']) (
    'rejects unsafe URL %s',
    (src) => {
      expect(validatePublicMarkdownAst(root(element('img', { src, alt: '' })))).toMatchObject({
        ok: false,
        issues: [expect.objectContaining({ code: 'unsafe_url' })],
      })
    },
  )

  it('accepts safe structural HTML and enforces registered component props', () => {
    const policy: PortableComponentPolicyV1 = {
      components: {
        HeroCard: {
          kind: 'block',
          props: {
            title: { type: 'string', required: true },
            featured: { type: 'boolean', required: false },
          },
          slots: [],
          media: null,
        },
      },
    }
    expect(validatePublicMarkdownAst(root(element('a', { href: '/docs', rel: 'next' })))).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(element('hero-card', { title: 'Hello' })), policy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(element('hero-card', { title: 'Hello', extra: true })), policy)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unknown_prop' })],
    })
  })

  it('accepts only normalized GFM alert metadata on blockquotes', () => {
    expect(validatePublicMarkdownAst(root(element('blockquote', { 'data-alert': 'note' })))).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(element('blockquote', { 'data-alert': 'custom' })))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'invalid_prop_value' })],
    })
  })

  it('accepts only the exact inert task checkbox shape emitted by normalization', () => {
    expect(validatePublicMarkdownAst(root(element('input', {
      type: 'checkbox',
      class: 'task-list-item-checkbox',
      disabled: true,
      checked: true,
    })))).toMatchObject({ ok: true })
    for (const props of [
      { type: 'text', class: 'task-list-item-checkbox', disabled: true },
      { type: 'checkbox', class: 'task-list-item-checkbox' },
      { type: 'checkbox', class: 'task-list-item-checkbox', disabled: true, onChange: 'run()' },
    ]) {
      expect(validatePublicMarkdownAst(root(element('input', props)))).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'unsafe_tag' })]),
      })
    }
  })

  it('accepts Math and Mermaid only through enabled reserved component contracts', () => {
    const policy = withMarkdownPluginComponentPolicy(undefined, [
      { name: 'math', parserPath: '', renderer: { path: '', exportName: 'Math', tag: 'ginko-math' } },
      { name: 'mermaid', parserPath: '', renderer: { path: '', exportName: 'Mermaid', tag: 'ginko-mermaid' } },
    ])
    const math = element('ginko-math', { class: 'math inline', content: 'x^2' })
    const mermaid = element('ginko-mermaid', { content: 'graph TD; A-->B' })

    expect(validatePublicMarkdownAst(root(math), policy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(mermaid), policy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(math))).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unknown_component' })]),
    })
    expect(validatePublicMarkdownAst(root(element('ginko-math', { class: 'arbitrary', content: 'x^2' })), policy)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid_prop_value' })]),
    })
    expect(validatePublicMarkdownAst(root(element('ginko-mermaid', { content: 'graph TD', width: '200%' })), policy)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid_prop_value' })]),
    })

    expect(normalizeComarkNodes([
      ['math', { class: 'math inline', content: 'x^2' }, 'x^2'],
      ['mermaid', { content: 'graph TD' }],
      ['math', { class: 'arbitrary', content: 'authored' }, 'authored'],
    ], { enabledPlugins: ['math', 'mermaid'] })).toEqual([
      ['ginko-math', { class: 'math inline', content: 'x^2' }, 'x^2'],
      ['ginko-mermaid', { content: 'graph TD' }],
      ['math', { class: 'arbitrary', content: 'authored' }, 'authored'],
    ])
  })

  it('allows named-slot templates only directly under their declared component slot', () => {
    const policy: PortableComponentPolicyV1 = {
      components: {
        Callout: {
          kind: 'block',
          props: {},
          slots: ['default', 'actions'],
          media: null,
        },
      },
    }
    const template = (name: string) => ({
      ...element('template', { name }),
      children: [{ type: 'text', value: 'Slot content' }],
    })
    const callout = (child: Record<string, unknown>) => ({ ...element('callout'), children: [child] })
    expect(validatePublicMarkdownAst(root(callout(template('actions'))), policy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(template('actions')), policy)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_tag' })],
    })
    expect(validatePublicMarkdownAst(root(callout(template('admin'))), policy)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_tag' })],
    })
  })

  it('allows only parser-owned table alignment and bounded code metadata', () => {
    for (const style of ['text-align:left', 'text-align:center', 'text-align:right']) {
      expect(validatePublicMarkdownAst(root(element('th', { style })))).toMatchObject({ ok: true })
    }
    for (const style of ['text-align:justify', 'color:red', 'text-align:center;background:red']) {
      expect(validatePublicMarkdownAst(root(element('td', { style })))).toMatchObject({
        ok: false,
        issues: [expect.objectContaining({ code: 'unsafe_prop' })],
      })
    }
    expect(validatePublicMarkdownAst(root(element('pre', {
      language: 'ts', meta: 'demo', highlights: [1, 3],
    })))).toMatchObject({ ok: true })
    for (const highlights of [[0], [-1], [1.5], [1_000_001], ['1']]) {
      expect(validatePublicMarkdownAst(root(element('pre', { highlights })))).toMatchObject({
        ok: false,
        issues: [expect.objectContaining({ code: 'invalid_prop_value' })],
      })
    }
    expect(validatePublicMarkdownAst(root(element('pre', { highlights: Array.from({ length: 257 }, (_, index) => index + 1) })))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'invalid_prop_value' })],
    })
    expect(validatePublicMarkdownAst(root(element('pre', { meta: 'x'.repeat(2049) })))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'invalid_prop_value' })],
    })
  })

  it('applies the canonical URL policy to registered asset props', () => {
    const policy: PortableComponentPolicyV1 = {
      components: {
        Media: {
          kind: 'block',
          props: { src: { type: 'asset', required: true } },
          slots: [],
          media: { sourceProp: 'src', altProp: null },
        },
      },
    }

    expect(validatePublicMarkdownAst(root(element('media', { src: 'javascript:alert(1)' })), policy)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_url' })],
    })
    expect(validatePublicMarkdownAst(root(element('media', { src: '/ginko-assets/image.png' })), policy)).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(element('media', { src: 'https://cdn.example.test/image.png' })), policy)).toMatchObject({ ok: true })
  })

  it('accepts passive code-block metadata emitted by the Markdown parser', () => {
    expect(validatePublicMarkdownAst(root(element('pre', {
      language: 'ts',
      filename: 'content.config.ts',
    })))).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(element('pre', { language: { executable: false } })))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'invalid_prop_value' })],
    })
  })

  it('accepts only the inert inline styles emitted by Shiki', () => {
    expect(validatePublicMarkdownAst(root(element('span', {
      style: 'color:#39ADB5;--shiki-dark:#89DDFF;--shiki-dark-font-style:italic',
    })))).toMatchObject({ ok: true })
    expect(validatePublicMarkdownAst(root(element('span', { style: 'display: inline' })))).toMatchObject({ ok: true })
    // @shikijs/transformers marks highlighted and diff lines with inline-block.
    expect(validatePublicMarkdownAst(root(element('span', { style: 'display: inline-block' })))).toMatchObject({ ok: true })
    for (const style of ['display: block', 'display: flex']) {
      expect(validatePublicMarkdownAst(root(element('span', { style })))).toMatchObject({
        ok: false,
        issues: [expect.objectContaining({ code: 'unsafe_prop' })],
      })
    }
    expect(validatePublicMarkdownAst(root(element('span', {
      style: 'background-image:url(https://evil.test/pixel)',
    })))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_prop' })],
    })
    expect(validatePublicMarkdownAst(root(element('div', { style: 'color:#39ADB5' })))).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'unsafe_prop' })],
    })
  })

  it('shares one HTTPS-only URL rule with agent Markdown serialization', () => {
    expect(isSafePublicMarkdownUrl('https://example.test/image.png', 'asset')).toBe(true)
    expect(isSafePublicMarkdownUrl('http://example.test/image.png', 'asset')).toBe(false)
    expect(isSafePublicMarkdownUrl('https://user:pass@example.test/image.png', 'asset')).toBe(false)
    expect(isSafePublicMarkdownUrl('mailto:hello@example.test')).toBe(true)
  })

  it('fails closed before an unsafe AST reaches Vue SSR', async () => {
    const app = createSSRApp({
      render: () =>
        h(MarkdownRenderer, {
          tree: root(element('img', { src: 'javascript:alert(1)', onerror: 'boom' })),
        }),
    })

    await expect(renderToString(app)).rejects.toMatchObject({
      name: 'PublicMarkdownValidationError',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'unsafe_prop' }),
        expect.objectContaining({ code: 'unsafe_url' }),
      ]),
    })
  })
})
