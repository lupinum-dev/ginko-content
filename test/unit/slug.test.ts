import { describe, expect, test } from 'vitest'
import { generatePath } from '../../packages/content/src/core/content/path'
import { slugifyUrlSegment } from '../../packages/content/src/core/content/slug'

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
