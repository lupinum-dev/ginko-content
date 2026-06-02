import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { parseContentVariants } from '../packages/content/src/integrations/nitro/ingest'
import pathMeta from '../packages/content/src/runtime/transformers/path-meta'
import { validateCollectionDocument, validateContentGraph } from '../packages/content/src/runtime/server/validation'
import { makeIgnored } from '../packages/content/src/core/content/ignore'
import { resolveCollection } from '../packages/content/src/core/content/collection'
import { buildReferenceTargets, collectMarkdownRefLinks, parseRefLink, rewriteMarkdownRefLinks } from '../packages/content/src/core/references/resolve'
import { collectTranslatedSlugValidationIssues } from '../packages/content/src/features/localization/translated-slugs'
import { resolveCollectionI18nConfig } from '../packages/content/src/features/localization/config'
import { buildLocaleFallbackChain, expandDataLocaleVariants, splitInlineLocaleVariantId } from '../packages/content/src/core/content/locale'
import { createRouteMeta, localizeNavigation, localizePageResult } from '../packages/content/src/features/localization/results'
import { defineCollection, reference } from '../packages/content/src/types/config'
import { getCollectionPath } from '../packages/content/src/runtime/query/routes'

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
      { _id: 'content:guide:.navigation.yml', body: {} as any },
      { locales: [], defaultLocale: 'en' }
    )

    expect(transformed._navigation).toBe(true)
    expect(transformed._partial).toBe(true)
    expect(transformed._path).toBe('/guide')
  })

  test('resolves collections against locale-aware file paths', () => {
    expect(resolveCollection('en/authors/evan.yml', { authors: { source: 'authors/*.yml' } }, ['en', 'de'])).toBe('authors')
  })

  test('normalizes v3-shaped page collections', () => {
    expect(defineCollection('docs', {
      type: 'page',
      source: 'docs/**/*.md',
      schema: z.object({ title: z.string() })
    })).toMatchObject({
      name: 'docs',
      type: 'page',
      source: 'docs/**/*.md',
      sitemap: undefined
    })
  })

  test('normalizes v3-shaped data collections with sitemap disabled by default', () => {
    expect(defineCollection('authors', {
      type: 'data',
      source: 'authors/*.yml'
    })).toMatchObject({
      name: 'authors',
      type: 'data',
      source: 'authors/*.yml',
      sitemap: false
    })
  })

  test('normalizes v3 source include and exclude objects', () => {
    expect(defineCollection('docs', {
      type: 'page',
      source: {
        include: 'docs/**/*.md',
        exclude: ['docs/private/**']
      }
    })).toMatchObject({
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
      { _id: 'content:de:1.leitfaden:1.erste-schritte.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )

    expect(transformed._locale).toBe('de')
    expect(transformed._path).toBe('/leitfaden/erste-schritte')
    expect(transformed._canonicalKey).toBe('1/1')
  })

  test('warns when translated slug entries are missing numeric prefixes', () => {
    const transformed = pathMeta.transform!(
      { _id: 'content:de:leitfaden:1.erste-schritte.md', body: {} as any },
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
      { _id: 'content:de:leitfaden:1.erste-schritte.md', body: {} as any, _type: 'markdown' } as any,
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
      { _id: 'content:de:1.leitfaden:1.erste-schritte.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )
    const second = pathMeta.transform!(
      { _id: 'content:de:1.leitfaden:1.einleitung.md', body: {} as any },
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

  test('requires explicit ids to stay aligned across locale variants', () => {
    const english = pathMeta.transform!(
      { _id: 'content:en:guide:getting-started.md', id: 'docs/intro', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const german = pathMeta.transform!(
      { _id: 'content:de:guide:getting-started.md', body: {} as any },
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
        message: expect.stringMatching(/must be declared consistently across locale variants/)
      }
    })
  })

  test('requires refs to stay aligned across locale variants', () => {
    const english = pathMeta.transform!(
      { _id: 'content:en:guide:getting-started.md', ref: 'guide-getting-started', body: {} as any, _type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const german = pathMeta.transform!(
      { _id: 'content:de:guide:getting-started.md', ref: 'leitfaden-erste-schritte', body: {} as any, _type: 'markdown' } as any,
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
      { _id: 'content:en:guide:getting-started.md', ref: 'guide-about', body: {} as any, _type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const second = pathMeta.transform!(
      { _id: 'content:en:blog:about.md', ref: 'guide-about', body: {} as any, _type: 'markdown' } as any,
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

  test('errors on duplicate explicit ids across unrelated documents', () => {
    const first = pathMeta.transform!(
      { _id: 'content:en:guide:getting-started.md', id: 'shared-id', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const second = pathMeta.transform!(
      { _id: 'content:de:blog:about.md', id: 'shared-id', body: {} as any },
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
        message: expect.stringMatching(/duplicate explicit id "shared-id"/)
      }
    })
  })

  test('rejects duplicate explicit ids in either order before reference targets can overwrite', () => {
    const first = pathMeta.transform!(
      { _id: 'content:en:guide:getting-started.md', id: 'shared-id', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const second = pathMeta.transform!(
      { _id: 'content:de:blog:about.md', id: 'shared-id', body: {} as any },
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
          message: expect.stringMatching(/duplicate explicit id "shared-id"/)
        }
      })
    }
  })

  test('validates strict collection schemas against user fields only', () => {
    const document = pathMeta.transform!(
      {
        _id: 'content:en:guide:getting-started.md',
        _type: 'markdown',
        body: {},
        title: 'Getting Started'
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document._collection = 'docs'

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
        _id: 'content:en:guide:getting-started.md',
        _path: '/guide/getting-started',
        title: 'Getting Started'
      })
    })
  })

  test('still fails strict schema validation for invalid user fields', () => {
    const document = pathMeta.transform!(
      {
        _id: 'content:en:guide:getting-started.md',
        _type: 'markdown',
        body: {},
        title: 123
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document._collection = 'docs'

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
        _id: 'content:en:pricing.yml',
        _type: 'yaml',
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
    document._collection = 'pricing'

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
      { _id: 'content:authors:evan.yml', _type: 'yaml', body: null, id: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    author._collection = 'authors'

    const post = pathMeta.transform!(
      { _id: 'content:posts:hello.md', _type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    post._collection = 'posts'

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

  test('rejects schema references that resolve in the wrong collection', () => {
    const relatedPost = pathMeta.transform!(
      { _id: 'content:posts:related.md', _type: 'markdown', body: {}, id: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    relatedPost._collection = 'posts'

    const article = pathMeta.transform!(
      { _id: 'content:posts:hello.md', _type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    article._collection = 'posts'

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

  test('allows unscoped schema references to resolve across collections', () => {
    const author = pathMeta.transform!(
      { _id: 'content:authors:evan.yml', _type: 'yaml', body: null, id: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    author._collection = 'authors'

    const post = pathMeta.transform!(
      { _id: 'content:posts:hello.md', _type: 'markdown', body: {}, author: 'evan' } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    post._collection = 'posts'

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
    const authors = defineCollection('authors', {
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
    expect(parseRefLink('$guide-advanced#deep-dive')).toEqual({
      ref: 'guide-advanced',
      hash: '#deep-dive'
    })
    expect(parseRefLink('/guide/advanced')).toBeNull()
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

  test('indexes explicit refs alongside canonical ids and paths', () => {
    const document = pathMeta.transform!(
      { _id: 'content:en:guide:getting-started.md', ref: 'guide-getting-started', body: {} as any, _type: 'markdown' } as any,
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const targets = buildReferenceTargets([document], ['en', 'de'])
    expect(targets.get('guide-getting-started')).toBe('/guide/getting-started')
    expect(targets.get('guide/getting-started')).toBe('/guide/getting-started')
  })

  test('expands inline data locale variants with deep object merge and array replacement', () => {
    const variants = expandDataLocaleVariants({
      _id: 'content:authors:evan.yml',
      _path: '/authors/evan',
      _file: 'authors/evan.yml',
      _collection: 'authors',
      _type: 'yaml',
      _locale: 'en',
      _canonicalKey: 'authors/evan',
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
      _id: 'content:authors:evan.yml#__locale=de',
      _locale: 'de',
      profile: {
        focus: 'DX',
        labels: ['de']
      }
    })
  })

  test('keeps data documents unchanged when inline i18n is empty or locale override matches source locale', () => {
    expect(expandDataLocaleVariants({
      _id: 'content:authors:evan.yml',
      _type: 'yaml',
      _locale: 'en',
      body: null,
      i18n: {}
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })).toHaveLength(1)

    expect(expandDataLocaleVariants({
      _id: 'content:authors:evan.yml',
      _type: 'json',
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
      _id: 'content:authors:evan.yml',
      _type: 'json',
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

    expect(variants.map(variant => variant._locale)).toEqual(['en', 'de'])
  })

  test('warns and skips non-object inline locale overrides', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const variants = expandDataLocaleVariants({
      _id: 'content:authors:evan.yml',
      _type: 'yaml',
      _locale: 'en',
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
      { _id: 'content:authors:evan.yml', body: null, _type: 'yaml' as const },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const fileVariant = pathMeta.transform!(
      { _id: 'content:de:authors:evan.yml', body: null, _type: 'yaml' as const },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )

    const inlineGerman = {
      ...inlineDefault,
      _id: 'content:authors:evan.yml#__locale=de',
      _locale: 'de'
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
      { _id: 'content:authors:evan.yml', body: null, _type: 'yaml' as const },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )
    const german = {
      ...english,
      _id: 'content:authors:evan.yml#__locale=de',
      _locale: 'de'
    }

    expect(english._canonicalKey).toBe('/authors/evan')
    expect(german._canonicalKey).toBe('/authors/evan')
    expect(english._path).toBe('/authors/evan')
  })

  test('localizes page links while leaving the page body immutable for render-time localization', () => {
    const page = {
      _path: '/demarrage',
      _file: 'fr/1.demarrage.md',
      _extension: 'md',
      _resolvedLocale: 'fr',
      _variantPaths: {
        en: '/getting-started',
        fr: '/demarrage'
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
      _path: '/docs/essentials/fallback-lab',
      _file: 'en/1.docs/2.essentials/5.fallback-lab.md',
      _extension: 'md',
      _locale: 'en',
      _requestedLocale: 'de',
      _resolvedLocale: 'en',
      _fallback: true,
      _requestedRoute: '/de/dokumentation/essentials/fallback-lab',
      _availableLocales: ['en'],
      _variantPaths: {
        en: '/docs/essentials/fallback-lab'
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
      _path: '/demarrage',
      _resolvedLocale: 'fr',
      _variantPaths: {
        en: '/getting-started',
        fr: '/demarrage'
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
        _path: '/demarrage',
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
