import { describe, expect, test } from 'vitest'
import { buildCanonicalNavigation } from '../../packages/content/src/features/navigation/build'
import { getNavigationIdentity, markCollectionNavigationRoot, mergeCanonicalNavigation, projectNavigationTree } from '../../packages/content/src/features/navigation/canonical'
import { createCollectionSurroundings } from '../../packages/content/src/features/navigation/tree'

describe('navigation tree contracts', () => {
  test('builds synthetic folder identity from child canonical keys and locale metadata', () => {
    const navigation = buildCanonicalNavigation([
      {
        title: 'Installation',
        _id: 'content:de:docs:getting-started:installation.md',
        _file: '/de/1.dokumentation/1.erste-schritte/installation.md',
        _path: '/dokumentation/erste-schritte/installation',
        _canonicalKey: 'docs/getting-started/installation',
        _locale: 'de'
      } as any
    ], {}, [])

    expect(navigation[0]).toMatchObject({
      title: 'Dokumentation',
      _navigationKind: 'folder',
      _canonicalKey: 'docs',
      _locale: 'de'
    })
    expect(navigation[0]?.children?.[0]).toMatchObject({
      title: 'Erste Schritte',
      _navigationKind: 'folder',
      _canonicalKey: 'docs/getting-started',
      _locale: 'de'
    })
  })

  test('merges fallback nodes by canonical identity without using titles', () => {
    const merged = mergeCanonicalNavigation([
      {
        title: 'Grundlagen',
        _canonicalKey: 'docs/essentials',
        _navigationKind: 'folder',
        children: [
          { title: 'Markdown Syntax', _path: '/dokumentation/grundlagen/markdown-syntax', _canonicalKey: 'docs/essentials/markdown-syntax', _navigationKind: 'page' }
        ]
      }
    ], [
      {
        title: 'Essentials',
        _canonicalKey: 'docs/essentials',
        _navigationKind: 'folder',
        children: [
          { title: 'Fallback Lab', _path: '/docs/essentials/fallback-lab', _canonicalKey: 'docs/essentials/fallback-lab', _navigationKind: 'page' }
        ]
      }
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ title: 'Grundlagen', _canonicalKey: 'docs/essentials' })
    expect(merged[0]?.children?.map(item => item.title)).toEqual(['Markdown Syntax', 'Fallback Lab'])

    expect(getNavigationIdentity({ title: 'Display Only' } as any)).toBeUndefined()
    expect(mergeCanonicalNavigation([
      { title: 'Same', _path: '/one', _navigationKind: 'page' }
    ], [
      { title: 'Same', _path: '/two', _navigationKind: 'page' }
    ])).toHaveLength(2)
    expect(mergeCanonicalNavigation([
      { title: 'Same', _path: '/same', _navigationKind: 'page' }
    ], [
      { title: 'Same', _path: '/same', _navigationKind: 'page' }
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
        _path: '/dokumentation',
        _canonicalKey: '1',
        _navigationKind: 'folder',
        children: [
          {
            title: 'Arbeitsablaeufe',
            _path: '/dokumentation/arbeitsablaeufe',
            _canonicalKey: '1/2',
            _navigationKind: 'folder',
            children: [
              {
                title: 'Content Routing',
                _path: '/dokumentation/arbeitsablaeufe/content-routing',
                _canonicalKey: '1/2/1',
                _navigationKind: 'page'
              },
              {
                title: 'Launch Checkliste',
                _path: '/dokumentation/arbeitsablaeufe/launch-checkliste',
                _canonicalKey: '1/2/2',
                _navigationKind: 'page'
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
      _canonicalKey: '1/2'
    })
    expect(navigation[0]).not.toHaveProperty('_path')
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
