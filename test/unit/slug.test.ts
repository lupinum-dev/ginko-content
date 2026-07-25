import { describe, expect, test } from 'vitest'
import { generatePath } from '../../packages/content/src/core/content/path'
import { slugifyUrlSegment } from '../../packages/content/src/core/content/slug'
import pathMeta from '../../packages/content/src/parsers/path-meta'
import { collectTranslatedSlugValidationIssues } from '../../packages/content/src/features/localization/translated-slugs'
import { validateContentGraph } from '../../packages/content/src/runtime/server/validation'

describe('content slug helpers', () => {
  test('normalizes route slugs with readable transliteration', () => {
    expect(slugifyUrlSegment('  Café Launch: What is new?  ')).toBe('cafe-launch-what-is-new')
    expect(slugifyUrlSegment('Release 2.0 / EN + DE')).toBe('release-2-0-en-plus-de')
    expect(slugifyUrlSegment('Hallo Welt Übersetzt')).toBe('hallo-welt-uebersetzt')
    expect(slugifyUrlSegment('Änderungen für Größe & Straße')).toBe('aenderungen-fuer-groesse-and-strasse')
    expect(slugifyUrlSegment('L\'œuvre & C++ @ Home')).toBe('loeuvre-and-c-plus-plus-at-home')
    expect(slugifyUrlSegment('Smørrebrød, Łódź, Þingvellir')).toBe('smorrebrod-lodz-thingvellir')
  })

  test('uses the same slugification for generated content paths', () => {
    expect(generatePath('blog/Hallo Welt Übersetzt')).toBe('/blog/hallo-welt-uebersetzt')
    expect(generatePath('Docs/Über Uns', { respectPathCase: true })).toBe('/Docs/Ueber-Uns')
  })
})

describe('translated slug validation', () => {
  test('derives canonical keys from numeric prefixes in translated slug mode', () => {
    const transformed = pathMeta.transform!(
      { id: 'content:de:1.leitfaden:1.erste-schritte.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )

    expect(transformed.locale).toBe('de')
    expect(transformed.path).toBe('/leitfaden/erste-schritte')
    expect(transformed.canonicalKey).toBe('1/1')
  })

  test('removes the configured source mount from both path and canonical identity', () => {
    const options = {
      locales: ['en', 'de'],
      defaultLocale: 'en',
      translatedSlugs: true,
      collectionResolver: () => 'docs',
      localePolicy: {
        docs: {
          localized: true,
          locales: ['en', 'de'],
          defaultLocale: 'en',
          fallback: {},
          translatedSlugs: true,
          routeMounts: { en: '/guide', de: '/leitfaden' }
        }
      }
    }
    const english = pathMeta.transform!(
      { id: 'content:en:1.guide:1.getting-started.md', body: {} as any },
      options
    )
    const german = pathMeta.transform!(
      { id: 'content:de:1.leitfaden:1.erste-schritte.md', body: {} as any },
      options
    )

    expect(english).toMatchObject({ path: '/getting-started', canonicalKey: '1' })
    expect(german).toMatchObject({ path: '/erste-schritte', canonicalKey: '1' })
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

  test('does not apply translated-slug validation to a single-locale collection', () => {
    const transformed = pathMeta.transform!(
      { id: 'content:docs:guide.md', body: {} as any },
      { locales: ['en'], defaultLocale: 'en', translatedSlugs: true }
    )

    expect(
      collectTranslatedSlugValidationIssues([transformed], {
        locales: ['en'],
        translatedSlugs: true
      })
    ).toEqual([])
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

  test('does not treat an ordered index file as a sibling route segment', () => {
    const index = pathMeta.transform!(
      { id: 'content:de:1.dokumentation:1.index.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )
    const child = pathMeta.transform!(
      { id: 'content:de:1.dokumentation:1.anleitungen:1.ueberblick.md', body: {} as any },
      { locales: ['en', 'de'], defaultLocale: 'en', translatedSlugs: true }
    )

    expect(
      collectTranslatedSlugValidationIssues([index, child], {
        locales: ['en', 'de'],
        translatedSlugs: true
      })
    ).toEqual([])
  })
})
