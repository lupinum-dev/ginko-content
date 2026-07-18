import { describe, expect, test } from 'vitest'
import { buildCanonicalNavigation } from '../../packages/content/src/features/navigation/build'
import { getNavigationIdentity, markCollectionNavigationRoot, mergeCanonicalNavigation, projectNavigationTree } from '../../packages/content/src/features/navigation/canonical'
import { createCollectionSurroundings } from '../../packages/content/src/features/navigation/tree'

describe('navigation tree contracts', () => {
  test('builds synthetic folder identity from child canonical keys and locale metadata', () => {
    const navigation = buildCanonicalNavigation([
      {
        title: 'Installation',
        id: 'content:de:docs:getting-started:installation.md',
        file: { path: '/de/1.dokumentation/1.erste-schritte/installation.md' },
        path: '/dokumentation/erste-schritte/installation',
        canonicalKey: 'docs/getting-started/installation',
        locale: 'de'
      } as any
    ], {}, [])

    expect(navigation[0]).toMatchObject({
      title: 'Dokumentation',
      navigationKind: 'folder',
      canonicalKey: 'docs',
      locale: 'de'
    })
    expect(navigation[0]?.children?.[0]).toMatchObject({
      title: 'Erste Schritte',
      navigationKind: 'folder',
      canonicalKey: 'docs/getting-started',
      locale: 'de'
    })
  })

  test('copies own __proto__ navigation metadata without changing item prototypes', () => {
    const page = Object.fromEntries([
      ['title', 'Guide'],
      ['id', 'content:en:guide:index.md'],
      ['file', { path: '/en/guide/index.md' }],
      ['path', '/guide'],
      ['canonicalKey', 'guide'],
      ['locale', 'en'],
      ['__proto__', { source: 'page' }]
    ])
    const directoryConfig = {
      title: 'Guides',
      navigation: JSON.parse('{"__proto__":{"source":"directory"},"badge":"Hot"}')
    }

    const navigation = buildCanonicalNavigation([page] as any, {
      '/guide': directoryConfig as any
    }, ['__proto__'])
    const item = navigation[0] as Record<string, unknown>

    expect(Object.getPrototypeOf(item)).toBe(Object.prototype)
    expect(Object.hasOwn(item, '__proto__')).toBe(true)
    expect(item.__proto__).toEqual({ source: 'directory' })
    expect(item).toMatchObject({ title: 'Guides', badge: 'Hot' })
  })

  test('merges fallback nodes by canonical identity without using titles', () => {
    const merged = mergeCanonicalNavigation([
      {
        title: 'Grundlagen',
        canonicalKey: 'docs/essentials',
        navigationKind: 'folder',
        children: [
          { title: 'Markdown Syntax', path: '/dokumentation/grundlagen/markdown-syntax', canonicalKey: 'docs/essentials/markdown-syntax', navigationKind: 'page' }
        ]
      }
    ], [
      {
        title: 'Essentials',
        canonicalKey: 'docs/essentials',
        navigationKind: 'folder',
        children: [
          { title: 'Fallback Lab', path: '/docs/essentials/fallback-lab', canonicalKey: 'docs/essentials/fallback-lab', navigationKind: 'page' }
        ]
      }
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ title: 'Grundlagen', canonicalKey: 'docs/essentials' })
    expect(merged[0]?.children?.map(item => item.title)).toEqual(['Markdown Syntax', 'Fallback Lab'])

    expect(getNavigationIdentity({ title: 'Display Only' } as any)).toBeUndefined()
    expect(mergeCanonicalNavigation([
      { title: 'Same', path: '/one', navigationKind: 'page' }
    ], [
      { title: 'Same', path: '/two', navigationKind: 'page' }
    ])).toHaveLength(2)
    expect(mergeCanonicalNavigation([
      { title: 'Same', path: '/same', navigationKind: 'page' }
    ], [
      { title: 'Same', path: '/same', navigationKind: 'page' }
    ])).toHaveLength(2)
  })

  test('projects collection roots once and keeps synthetic folders pathless for surroundings', () => {
    const routeMounts = {
      en: '/docs',
      de: '/dokumentation'
    }
    const canonicalNavigation = markCollectionNavigationRoot([
      {
        title: 'Dokumentation',
        path: '/dokumentation',
        canonicalKey: '1',
        navigationKind: 'folder',
        children: [
          {
            title: 'Arbeitsablaeufe',
            path: '/dokumentation/arbeitsablaeufe',
            canonicalKey: '1/2',
            navigationKind: 'folder',
            children: [
              {
                title: 'Content Routing',
                path: '/dokumentation/arbeitsablaeufe/content-routing',
                canonicalKey: '1/2/1',
                navigationKind: 'page'
              },
              {
                title: 'Launch Checkliste',
                path: '/dokumentation/arbeitsablaeufe/launch-checkliste',
                canonicalKey: '1/2/2',
                navigationKind: 'page'
              }
            ]
          }
        ]
      }
    ], 'docs', { routeMounts })
    const navigation = projectNavigationTree(canonicalNavigation, {
      collection: 'docs',
      locale: 'de',
      defaultLocale: 'en',
      routeMounts
    })

    expect(navigation).toHaveLength(1)
    expect(navigation[0]).toMatchObject({
      title: 'Arbeitsablaeufe',
      canonicalKey: '1/2'
    })
    expect(navigation[0]).not.toHaveProperty('path')
    expect(navigation[0]).not.toHaveProperty('path')
    expect(navigation[0]?.children?.map(item => item.path)).toEqual([
      '/de/dokumentation/arbeitsablaeufe/content-routing',
      '/de/dokumentation/arbeitsablaeufe/launch-checkliste'
    ])

    expect(createCollectionSurroundings(navigation, '/de/dokumentation/arbeitsablaeufe/content-routing')).toEqual([
      null,
      expect.objectContaining({ title: 'Launch Checkliste' })
    ])
  })
})
