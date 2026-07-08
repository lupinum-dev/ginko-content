import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { parseContentVariants } from '../packages/content/src/integrations/nitro/ingest'
import pathMeta from '../packages/content/src/runtime/transformers/path-meta'
import { validateCollectionDocument, validateContentGraph } from '../packages/content/src/runtime/server/validation'
import { makeIgnored } from '../packages/content/src/core/content/ignore'
import { resolveCollection } from '../packages/content/src/core/content/collection'
import { buildReferenceTargets, collectMarkdownRefLinks, parseRefLink, resolveConfiguredQuickLink, resolveConfiguredQuickLinks, resolveMarkdownRenderRefs, rewriteMarkdownRefLinks } from '../packages/content/src/core/references/resolve'
import { collectTopLevelReferenceFields, collectTopLevelReferenceFieldsByTarget } from '../packages/content/src/core/references/schema'
import { collectTranslatedSlugValidationIssues } from '../packages/content/src/features/localization/translated-slugs'
import { resolveCollectionI18nConfig } from '../packages/content/src/features/localization/config'
import { buildLocaleFallbackChain, expandDataLocaleVariants, splitInlineLocaleVariantId } from '../packages/content/src/core/content/locale'
import { createRouteMeta, localizeNavigation, localizePageResult } from '../packages/content/src/features/localization/results'
import { defineCollection, defineContentConfig, reference } from '../packages/content/src/types/config'
import { fields } from '../packages/content/src/types/fields'
import { getCollectionPath } from '../packages/content/src/features/query/routes'

vi.stubGlobal('__ginkoTestNitroApp', {
  hooks: {
    callHook: vi.fn()
  }
})

describe('Ginko metadata helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('does not ignore .navigation.yml files', () => {
    const ignored = makeIgnored([])
    expect(ignored('content:guide:.navigation.yml')).toBe(false)
  })

  test('marks .navigation.yml as folder metadata', () => {
    const transformed = pathMeta.transform!(
      { id: 'content:guide:.navigation.yml', body: {} as any },
      { locales: [], defaultLocale: 'en' }
    )

    expect(transformed.navigationFile).toBe(true)
    expect(transformed.partial).toBe(true)
    expect(transformed.path).toBe('/guide')
  })

  test('resolves collections against locale-aware file paths', () => {
    expect(resolveCollection('en/authors/evan.yml', { authors: { source: 'authors/*.yml' } }, ['en', 'de'])).toBe('authors')
  })

  test('normalizes v3-shaped page collections', () => {
    const docs = defineCollection({
      type: 'page',
      source: 'docs/**/*.md',
      schema: z.object({ title: z.string() })
    })

    const config = defineContentConfig({
      collections: { docs }
    })

    expect(config.collections.docs).toMatchObject({
      name: 'docs',
      type: 'page',
      source: 'docs/**/*.md',
      sitemap: undefined
    })
  })

  test('derives unnamed collection identity from defineContentConfig map keys', () => {
    const docs = defineCollection({
      type: 'page',
      source: 'docs/**/*.md',
      schema: z.object({ title: z.string() })
    })

    expect(docs).not.toHaveProperty('name')

    const config = defineContentConfig({
      collections: { docs }
    })

    expect(config.collections.docs).toMatchObject({
      name: 'docs',
      type: 'page',
      source: 'docs/**/*.md',
      sitemap: undefined
    })
    expect(docs.name).toBe('docs')
  })

  test('rejects stale collection names that drift from config map keys', () => {
    const guides = {
      name: 'guides',
      type: 'page',
      source: 'docs/**/*.md'
    }

    expect(() => defineContentConfig({
      collections: { docs: guides }
    })).toThrow('@lupinum/ginko-content collection key "docs" must match collection name "guides"')
  })

  test('rejects the removed named defineCollection overload at runtime', () => {
    expect(() => (defineCollection as unknown as (...args: unknown[]) => unknown)('docs', {
      type: 'page',
      source: 'docs/**/*.md'
    })).toThrow('@lupinum/ginko-content defineCollection(name, config) was removed')
  })

  test('normalizes v3-shaped data collections with sitemap disabled by default', () => {
    const authors = defineCollection({
      type: 'data',
      source: 'authors/*.yml'
    })

    const config = defineContentConfig({
      collections: { authors }
    })

    expect(config.collections.authors).toMatchObject({
      name: 'authors',
      type: 'data',
      source: 'authors/*.yml',
      sitemap: false
    })
  })

  test('normalizes v3 source include and exclude objects', () => {
    const docs = defineCollection({
      type: 'page',
      source: {
        include: 'docs/**/*.md',
        exclude: ['docs/private/**']
      }
    })

    const config = defineContentConfig({
      collections: { docs }
    })

    expect(config.collections.docs).toMatchObject({
      name: 'docs',
      type: 'page',
      source: 'docs/**/*.md',
      exclude: ['docs/private/**'],
      sitemap: undefined
    })
  })

  test('does not resolve excluded collection files', () => {
    const collections = {
      docs: {
        source: 'docs/**/*.md',
        exclude: 'docs/private/**'
      }
    }

    expect(resolveCollection('docs/getting-started.md', collections)).toBe('docs')
    expect(resolveCollection('docs/private/internal.md', collections)).toBeUndefined()
  })

  test('derives canonical keys from numeric prefixes in translated slug mode', () => {
    const transformed = pathMeta.transform!(
      { id: 'content:de:1.leitfaden:1.erste-schritte.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )

    expect(transformed.locale).toBe('de')
    expect(transformed.path).toBe('/leitfaden/erste-schritte')
    expect(transformed.canonicalKey).toBe('1/1')
  })

  test('warns when translated slug entries are missing numeric prefixes', () => {
    const transformed = pathMeta.transform!(
      { id: 'content:de:leitfaden:1.erste-schritte.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )

    expect(collectTranslatedSlugValidationIssues([transformed], {
      locales: ['en', 'de'],
      translatedSlugs: true
    })).toEqual([
      expect.objectContaining({
        level: 'warn',
        reason: 'translated slug mode expects numeric prefixes for localized route segments'
      })
    ])
  })

  test('can escalate translated slug warnings to validation errors', () => {
    const transformed = pathMeta.transform!(
      { id: 'content:de:leitfaden:1.erste-schritte.md', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )

    const outcome = validateContentGraph([transformed], {
      locales: ['en', 'de'],
      translatedSlugs: true,
      strictTranslatedSlugs: true,
      collections: {}
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'TRANSLATED_SLUG_CONFLICT',
        message: expect.stringContaining('translated slug mode expects numeric prefixes')
      }
    })
  })

  test('errors on duplicate sibling numeric prefixes in translated slug mode', () => {
    const first = pathMeta.transform!(
      { id: 'content:de:1.leitfaden:1.erste-schritte.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )
    const second = pathMeta.transform!(
      { id: 'content:de:1.leitfaden:1.einleitung.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )

    expect(collectTranslatedSlugValidationIssues([first, second], {
      locales: ['en', 'de'],
      translatedSlugs: true
    })).toEqual([
      expect.objectContaining({
        level: 'error',
        reason: 'duplicate numeric prefix "1" among localized siblings'
      })
    ])
  })

  test('allows a ref declared on only one locale variant of a canonical group', () => {
    const english = pathMeta.transform!(
      { id: 'content:en:guide:getting-started.md', ref: 'guide-intro', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const german = pathMeta.transform!(
      { id: 'content:de:guide:getting-started.md', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const outcome = validateContentGraph([english, german], {
      locales: ['en', 'de'],
      translatedSlugs: false,
      collections: {}
    })
    expect(outcome).toMatchObject({ ok: true })
  })

  test('requires refs to stay aligned across locale variants', () => {
    const english = pathMeta.transform!(
      { id: 'content:en:guide:getting-started.md', ref: 'guide-getting-started', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const german = pathMeta.transform!(
      { id: 'content:de:guide:getting-started.md', ref: 'leitfaden-erste-schritte', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const outcome = validateContentGraph([english, german], {
      locales: ['en', 'de'],
      translatedSlugs: false,
      collections: {}
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'CONFLICTING_REFS',
        message: expect.stringMatching(/conflicting refs across locale variants/)
      }
    })
  })

  test('errors on duplicate refs across unrelated markdown documents', () => {
    const first = pathMeta.transform!(
      { id: 'content:en:guide:getting-started.md', ref: 'guide-about', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const second = pathMeta.transform!(
      { id: 'content:en:blog:about.md', ref: 'guide-about', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const outcome = validateContentGraph([first, second], {
      locales: ['en', 'de'],
      translatedSlugs: false,
      collections: {}
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'CONFLICTING_REFS',
        message: expect.stringMatching(/duplicate ref "guide-about"/)
      }
    })
  })

  test('rejects duplicate refs in either order before reference targets can overwrite', () => {
    const first = pathMeta.transform!(
      { id: 'content:en:guide:getting-started.md', ref: 'shared-ref', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const second = pathMeta.transform!(
      { id: 'content:de:blog:about.md', ref: 'shared-ref', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    for (const documents of [[first, second], [second, first]]) {
      const outcome = validateContentGraph(documents, {
        locales: ['en', 'de'],
        translatedSlugs: false,
        collections: {}
      })
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          code: 'CONFLICTING_REFS',
          message: expect.stringMatching(/duplicate ref "shared-ref"/)
        }
      })
    }
  })

  test('validates strict collection schemas against user fields only', () => {
    const document = pathMeta.transform!(
      {
        id: 'content:en:guide:getting-started.md',
        type: 'markdown',
        body: {},
        title: 'Getting Started'
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document.collection = 'docs'

    const outcome = validateCollectionDocument(document, {
      docs: {
        source: 'guide/*.md',
        schema: z.object({
          title: z.string()
        }).strict()
      }
    })

    expect(outcome).toMatchObject({
      ok: true,
      value: expect.objectContaining({
        id: 'content:en:guide:getting-started.md',
        path: '/guide/getting-started',
        title: 'Getting Started'
      })
    })
  })

  test('still fails strict schema validation for invalid user fields', () => {
    const document = pathMeta.transform!(
      {
        id: 'content:en:guide:getting-started.md',
        type: 'markdown',
        body: {},
        title: 123
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document.collection = 'docs'

    const outcome = validateCollectionDocument(document, {
      docs: {
        source: 'guide/*.md',
        schema: z.object({
          title: z.string()
        }).strict()
      }
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: expect.stringContaining('title')
      }
    })
  })

  test('fails strict schema validation for missing nested required fields', () => {
    const document = pathMeta.transform!(
      {
        id: 'content:en:pricing.yml',
        type: 'yaml',
        body: null,
        plans: [
          {
            title: 'Starter',
            price: {
              month: '$9',
              year: '$90'
            }
          }
        ]
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document.collection = 'pricing'

    const outcome = validateCollectionDocument(document, {
      pricing: {
        source: 'pricing.yml',
        schema: z.object({
          plans: z.array(z.object({
            title: z.string(),
            billing_period: z.string().nonempty(),
            billing_cycle: z.string().nonempty()
          }))
        })
      }
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        context: {
          details: expect.stringContaining('plans.0.billing_period')
        },
        message: expect.stringContaining('plans.0.billing_cycle')
      }
    })
  })

  test('ingest validates source files against live collection schemas', async () => {
    await expect(parseContentVariants(
      'content:en:pricing.yml',
      [
        'plans:',
        '  - title: Starter',
        '    price:',
        '      month: "$9"',
        '      year: "$90"'
      ].join('\n'),
      {
        locales: ['en'],
        defaultLocale: 'en',
        translatedSlugs: false,
        respectPathCase: false,
        markdown: {},
        yaml: {},
        csv: {},
        collections: {
          pricing: {
            source: 'pricing.yml',
            schema: z.object({
              plans: z.array(z.object({
                title: z.string(),
                billing_period: z.string().nonempty(),
                billing_cycle: z.string().nonempty()
              }))
            })
          }
        }
      } as any
    )).rejects.toMatchObject({
      code: 'SCHEMA_VALIDATION_FAILED',
      context: {
        collection: 'pricing',
        details: expect.stringContaining('plans.0.billing_period')
      }
    })
  })

  test('scopes schema references to the declared target collection', () => {
    const author = pathMeta.transform!(
      { id: 'content:authors:evan.yml', type: 'yaml', body: null, ref: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    author.collection = 'authors'

    const post = pathMeta.transform!(
      { id: 'content:posts:hello.md', type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    post.collection = 'posts'

    const outcome = validateContentGraph([author, post], {
      locales: ['en'],
      translatedSlugs: false,
      collections: {
        posts: {
          source: 'posts/*.md',
          schema: z.object({
            author: reference('authors')
          })
        },
        authors: {
          source: 'authors/*.yml'
        }
      }
    })

    expect(outcome).toMatchObject({ ok: true })
  })

  test('derives backlink relation metadata from top-level schema references', () => {
    const schema = z.object({
      authors: fields.relations('authors'),
      editor: fields.relation('authors'),
      related: z.array(reference('posts')),
      external: reference()
    })

    expect(collectTopLevelReferenceFieldsByTarget(schema)).toEqual({
      authors: ['authors', 'editor'],
      posts: ['related'],
      '*': ['external']
    })
    expect(collectTopLevelReferenceFields(schema, 'authors')).toEqual(['authors', 'editor', 'external'])
  })

  test('rejects schema references that resolve in the wrong collection', () => {
    const relatedPost = pathMeta.transform!(
      { id: 'content:posts:related.md', type: 'markdown', body: {}, ref: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    relatedPost.collection = 'posts'

    const article = pathMeta.transform!(
      { id: 'content:posts:hello.md', type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    article.collection = 'posts'

    const outcome = validateContentGraph([relatedPost, article], {
      locales: ['en'],
      translatedSlugs: false,
      collections: {
        posts: {
          source: 'posts/*.md',
          schema: z.object({
            author: reference('authors')
          })
        },
        authors: {
          source: 'authors/*.yml'
        }
      }
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: expect.stringContaining('author: unresolved reference "evan" in collection "authors"')
      }
    })
  })

  test('validates derived reference metadata without live collection schemas', () => {
    const relatedPost = pathMeta.transform!(
      { id: 'content:posts:related.md', type: 'markdown', body: {}, ref: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    relatedPost.collection = 'posts'

    const article = pathMeta.transform!(
      { id: 'content:posts:hello.md', type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    article.collection = 'posts'

    const outcome = validateContentGraph([relatedPost, article], {
      locales: ['en'],
      translatedSlugs: false,
      collections: {
        posts: {
          source: 'posts/*.md',
          references: {
            authors: ['author']
          }
        } as any,
        authors: {
          source: 'authors/*.yml'
        }
      }
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: expect.stringContaining('author: unresolved reference "evan" in collection "authors"')
      }
    })
  })

  test('allows unscoped schema references to resolve across collections', () => {
    const author = pathMeta.transform!(
      { id: 'content:authors:evan.yml', type: 'yaml', body: null, ref: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    author.collection = 'authors'

    const post = pathMeta.transform!(
      { id: 'content:posts:hello.md', type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    post.collection = 'posts'

    const outcome = validateContentGraph([author, post], {
      locales: ['en'],
      translatedSlugs: false,
      collections: {
        posts: {
          source: 'posts/*.md',
          schema: z.object({
            author: reference()
          })
        },
        authors: {
          source: 'authors/*.yml'
        }
      }
    })

    expect(outcome).toMatchObject({ ok: true })
  })

  test('resolves collection i18n from the global content config by default', () => {
    expect(resolveCollectionI18nConfig({ source: 'authors/*.yml' }, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })).toEqual({
      defaultLocale: 'en',
      locales: ['en', 'de']
    })
  })

  test('prefers explicit per-collection i18n config', () => {
    expect(resolveCollectionI18nConfig({
      source: 'authors/*.yml',
      i18n: {
        defaultLocale: 'fr',
        locales: ['fr', 'en']
      }
    }, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })).toEqual({
      defaultLocale: 'fr',
      locales: ['fr', 'en']
    })
  })

  test('builds localized collection paths from collection route config', () => {
    const config = defineContentConfig({
      collections: {
        authors: defineCollection({
          type: 'data',
          source: 'authors/*.yml',
          route: {
            en: '/authors',
            de: '/autoren'
          },
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de']
          }
        })
      }
    })
    const authors = config.collections.authors

    expect(getCollectionPath(authors, { slug: 'alexia', locale: 'en' })).toBe('/authors/alexia')
    expect(getCollectionPath(authors, { slug: 'alexia', locale: 'de' })).toBe('/de/autoren/alexia')
    expect(getCollectionPath(authors, { slug: ['team', 'alexia'], locale: 'de', canonical: true })).toBe('/autoren/team/alexia')
  })

  test('returns undefined for i18n shorthand without global config', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveCollectionI18nConfig({
      source: 'authors/*.yml',
      i18n: true
    }, undefined, { warnMissingGlobal: true })).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('set i18n: true but no content.i18n config was found in nuxt.config.ts'))
  })

  test('builds locale fallback chains without duplicates', () => {
    expect(buildLocaleFallbackChain('de', 'en', { de: ['fr', 'en'] })).toEqual(['fr', 'en'])
    expect(buildLocaleFallbackChain('en', 'en', { en: ['fr'] })).toEqual(['fr'])
    expect(buildLocaleFallbackChain('de', undefined, undefined)).toEqual([])
  })

  test('splits inline locale variant ids safely', () => {
    expect(splitInlineLocaleVariantId('content:authors:evan.yml')).toEqual({
      sourceId: 'content:authors:evan.yml',
      locale: undefined
    })
    expect(splitInlineLocaleVariantId('content:authors:evan.yml#__locale=de')).toEqual({
      sourceId: 'content:authors:evan.yml',
      locale: 'de'
    })
    expect(splitInlineLocaleVariantId('content:authors:evan.yml#__locale=')).toEqual({
      sourceId: 'content:authors:evan.yml',
      locale: undefined
    })
  })

  test('parses markdown ref links with optional hash fragments', () => {
    expect(parseRefLink('$guide-advanced')).toEqual({
      ref: 'guide-advanced',
      hash: ''
    })
    expect(parseRefLink('$docs.getting-started')).toEqual({
      ref: 'docs.getting-started',
      hash: ''
    })
    expect(parseRefLink('$guide-advanced#deep-dive')).toEqual({
      ref: 'guide-advanced',
      hash: '#deep-dive'
    })
    expect(parseRefLink('/guide/advanced')).toBeNull()
    expect(parseRefLink('ref:guide-advanced')).toBeNull()
    expect(parseRefLink('$#hash-only')).toBeNull()
  })

  test('collects and rewrites markdown ref links without mutating the original body', () => {
    const body = {
      type: 'root',
      children: [
        {
          type: 'element',
          tag: 'p',
          props: {},
          children: [
            {
              type: 'element',
              tag: 'a',
              props: {
                href: '$guide-advanced#deep-dive'
              },
              children: [
                {
                  type: 'text',
                  value: 'Advanced'
                }
              ]
            }
          ]
        }
      ]
    }

    expect(collectMarkdownRefLinks(body)).toEqual(['$guide-advanced#deep-dive'])

    const rewritten = rewriteMarkdownRefLinks(body, {
      '$guide-advanced#deep-dive': '/guide/advanced#deep-dive'
    })

    expect(rewritten.children[0].children[0].props.href).toBe('/guide/advanced#deep-dive')
    expect(body.children[0].children[0].props.href).toBe('$guide-advanced#deep-dive')
  })

  test('resolves configured markdown quick links to route names with hashes', () => {
    const links = {
      main: {
        pricing: { route: 'pricing' },
        account: {
          route: 'account-section',
          params: { section: 'billing' },
          query: { upgrade: true, empty: undefined }
        }
      }
    }

    expect(resolveConfiguredQuickLink('$main.pricing#plans', links, route => `/de/${route.name}${route.hash || ''}`)).toBe('/de/pricing#plans')
    expect(resolveConfiguredQuickLink('$main.account', links, route => {
      expect(route).toEqual({
        name: 'account-section',
        params: { section: 'billing' },
        query: { upgrade: true, empty: undefined }
      })
      return '/de/account/billing?upgrade=true'
    })).toBe('/de/account/billing?upgrade=true')
    expect(resolveConfiguredQuickLinks(['$main.pricing', '$docs.getting-started'], links, route => `/${route.name}`)).toEqual({
      '$main.pricing': '/pricing'
    })
    expect(resolveConfiguredQuickLink('$main', links, route => `/${route.name}`)).toBeUndefined()
    expect(resolveConfiguredQuickLink('/pricing', links, route => `/${route.name}`)).toBeUndefined()
  })

  test('combines render-time quick links with concrete content refs', () => {
    const body = {
      type: 'root',
      children: [
        { type: 'element', tag: 'a', props: { href: '$main.pricing#plans' }, children: [] },
        { type: 'element', tag: 'card', props: { to: '$docs.getting-started' }, children: [] }
      ]
    }

    expect(resolveMarkdownRenderRefs(
      body,
      {
        '$main.pricing#plans': '$main.pricing#plans',
        '$docs.getting-started': '/de/docs/einstieg'
      },
      {
        main: {
          pricing: { route: 'pricing' }
        }
      },
      route => `/de/${route.name}${route.hash || ''}`
    )).toEqual({
      '$main.pricing#plans': '/de/pricing#plans',
      '$docs.getting-started': '/de/docs/einstieg'
    })
  })

  test('rewrites markdown component link props with the same ref resolver', () => {
    const body = {
      type: 'root',
      children: [
        { type: 'element', tag: 'card', props: { to: '$docs.getting-started' }, children: [] },
        { type: 'element', tag: 'a', props: { href: '$main.pricing' }, children: [] }
      ]
    }

    expect(collectMarkdownRefLinks(body)).toEqual(['$docs.getting-started', '$main.pricing'])

    const rewritten = rewriteMarkdownRefLinks(body, {
      '$docs.getting-started': '/de/docs/einstieg',
      '$main.pricing': '/de/pricing'
    })

    expect(rewritten.children[0].props.to).toBe('/de/docs/einstieg')
    expect(rewritten.children[1].props.href).toBe('/de/pricing')
    expect(body.children[0].props.to).toBe('$docs.getting-started')
  })

  test('indexes explicit refs alongside canonical ids and paths', () => {
    const document = pathMeta.transform!(
      { id: 'content:en:guide:getting-started.md', ref: 'guide-getting-started', body: {} as any, type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const targets = buildReferenceTargets([document], ['en', 'de'])
    expect(targets.get('guide-getting-started')).toBe('/guide/getting-started')
    expect(targets.get('guide/getting-started')).toBe('/guide/getting-started')
  })

  test('expands inline data locale variants with deep object merge and array replacement', () => {
    const variants = expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      path: '/authors/evan',
      file: { path: 'authors/evan.yml' },
      collection: 'authors',
      type: 'yaml',
      locale: 'en',
      canonicalKey: 'authors/evan',
      body: null,
      name: 'Evan You',
      profile: {
        focus: 'DX',
        labels: ['default']
      },
      i18n: {
        de: {
          profile: {
            labels: ['de']
          }
        }
      }
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })

    expect(variants).toHaveLength(2)
    expect(variants[1]).toMatchObject({
      id: 'content:authors:evan.yml#__locale=de',
      locale: 'de',
      profile: {
        focus: 'DX',
        labels: ['de']
      }
    })
  })

  test('keeps data documents unchanged when inline i18n is empty or locale override matches source locale', () => {
    expect(expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      type: 'yaml',
      locale: 'en',
      body: null,
      i18n: {}
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })).toHaveLength(1)

    expect(expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      type: 'json',
      body: null,
      i18n: {
        en: {
          name: 'Evan You'
        }
      }
    } as any, {
      defaultLocale: 'en',
      locales: ['en']
    })).toHaveLength(1)
  })

  test('expands data variants even when the source document has no explicit locale', () => {
    const variants = expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      type: 'json',
      body: null,
      name: 'Evan You',
      i18n: {
        de: {
          name: 'Evan You DE'
        }
      }
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })

    expect(variants.map(variant => variant.locale)).toEqual(['en', 'de'])
  })

  test('warns and skips non-object inline locale overrides', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const variants = expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      type: 'yaml',
      locale: 'en',
      body: null,
      i18n: {
        de: 'not-an-object'
      }
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })

    expect(variants).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('must be an object. Skipping invalid override'))
  })

  test('errors when inline and file-based locale variants collide on the same canonical locale', () => {
    const inlineDefault = pathMeta.transform!(
      { id: 'content:authors:evan.yml', body: null, type: 'yaml' as const },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const fileVariant = pathMeta.transform!(
      { id: 'content:de:authors:evan.yml', body: null, type: 'yaml' as const },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const inlineGerman = {
      ...inlineDefault,
      id: 'content:authors:evan.yml#__locale=de',
      locale: 'de'
    }

    const outcome = validateContentGraph([inlineDefault, inlineGerman, fileVariant], {
      locales: ['en', 'de'],
      translatedSlugs: false,
      collections: {}
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'DUPLICATE_CANONICAL_ID',
        message: expect.stringMatching(/duplicate canonical id .* locale "de"/)
      }
    })
  })

  test('indexes data variants in canonical space but not through localized routes', () => {
    const english = pathMeta.transform!(
      { id: 'content:authors:evan.yml', body: null, type: 'yaml' as const },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const german = {
      ...english,
      id: 'content:authors:evan.yml#__locale=de',
      locale: 'de'
    }

    expect(english.canonicalKey).toBe('/authors/evan')
    expect(german.canonicalKey).toBe('/authors/evan')
    expect(english.path).toBe('/authors/evan')
  })

  test('localizes page links while leaving the page body immutable for render-time localization', () => {
    const page = {
      path: '/demarrage',
      file: { path: 'fr/1.demarrage.md', extension: 'md' },
      resolved: {
        locale: 'fr',
        variantPaths: {
          en: '/getting-started',
          fr: '/demarrage'
        }
      },
      links: [
        { to: '/demarrage/installation' }
      ],
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'u-page-cta',
            props: {
              ':links': '[{"to":"/demarrage/installation"},{"href":"/demarrage/usage"}]'
            },
            children: []
          },
          {
            type: 'element',
            tag: 'a',
            props: {
              href: '/demarrage/installation#manual'
            },
            children: []
          }
        ]
      }
    } as any

    const localized = localizePageResult(page, 'fr', 'en', ['en', 'fr'])

    expect(localized.path).toBe('/fr/demarrage')
    expect(localized.resolved).toMatchObject({
      locale: 'fr',
      requestedLocale: 'fr',
      fallback: false,
      path: '/fr/demarrage',
      availableLocales: ['en', 'fr']
    })
    expect(localized.links?.[0]).toMatchObject({ to: '/fr/demarrage/installation' })
    expect(localized.body).toBe(page.body)
    expect(localized.body.children[0].props[':links']).toBe('[{"to":"/demarrage/installation"},{"href":"/demarrage/usage"}]')
    expect(localized.body.children[1].props.href).toBe('/demarrage/installation#manual')
  })

  test('exposes public resolution metadata for locale fallback results', () => {
    const localized = localizePageResult({
      path: '/docs/essentials/fallback-lab',
      file: { path: 'en/1.docs/2.essentials/5.fallback-lab.md', extension: 'md' },
      locale: 'en',
      resolved: {
        requestedLocale: 'de',
        locale: 'en',
        fallback: true,
        requestedRoute: '/de/dokumentation/essentials/fallback-lab',
        availableLocales: ['en'],
        variantPaths: {
          en: '/docs/essentials/fallback-lab'
        }
      },
      body: null
    } as any, 'de', 'en', ['en', 'de'])

    expect(localized.path).toBe('/de/docs/essentials/fallback-lab')
    expect(localized.resolved).toEqual({
      locale: 'en',
      requestedLocale: 'de',
      fallback: true,
      fallbackLocale: 'en',
      path: '/de/docs/essentials/fallback-lab',
      requestedRoute: '/de/dokumentation/essentials/fallback-lab',
      availableLocales: ['en']
    })
  })

  test('creates route metadata and localized navigation ready for rendering', () => {
    const meta = createRouteMeta({
      path: '/demarrage',
      resolved: {
        locale: 'fr',
        variantPaths: {
          en: '/getting-started',
          fr: '/demarrage'
        }
      }
    } as any, 'fr', 'en')

    expect(meta).toMatchObject({
      path: '/fr/demarrage',
      canonicalPath: '/demarrage',
      locale: 'fr',
      defaultLocale: 'en',
      variants: [
        {
          locale: 'en',
          path: '/getting-started',
          canonicalPath: '/getting-started'
        },
        {
          locale: 'fr',
          path: '/fr/demarrage',
          canonicalPath: '/demarrage'
        }
      ],
      localePaths: {
        en: { path: '/getting-started', translated: true },
        fr: { path: '/fr/demarrage', translated: true }
      },
      resolved: {
        locale: 'fr',
        requestedLocale: 'fr',
        fallback: false,
        path: '/fr/demarrage',
        availableLocales: ['en', 'fr']
      }
    })

    expect(localizeNavigation([
      {
        title: 'Demarrage',
        path: '/demarrage'
      }
    ], 'fr', 'en', ['en', 'fr'])).toEqual([
      expect.objectContaining({
        path: '/fr/demarrage',
        canonicalPath: '/demarrage'
      })
    ])
  })
})
