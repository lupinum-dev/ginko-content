import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import {
  isSafePublicMarkdownUrl,
  validatePublicMarkdownAst,
  type PortableComponentPolicyV1,
} from '../../packages/content/src/cms-contract'
import MarkdownRenderer from '../../packages/content/src/runtime/app/components/internal/MarkdownRenderer'

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
