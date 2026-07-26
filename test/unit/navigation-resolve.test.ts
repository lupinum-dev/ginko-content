import { describe, expect, expectTypeOf, test } from 'vitest'
import {
  findFirstNavigationChild,
  findFirstNavigationPage,
  findNavigationTrail,
  navigationItemContainsPath,
  normalizeNavigationPath,
  walkNavigationTree
} from '../../packages/content/src/public/navigation'

type DocsItem = {
  id: string
  title: string
  path?: string
  sidebar?: 'section' | 'group'
  children: DocsItem[]
}

const createNormalizedTree = (): DocsItem[] => [
  {
    id: 'docs:0',
    title: 'Docs',
    sidebar: 'section',
    children: [
      { id: 'docs:0.0', title: 'Intro', path: '/docs/intro/', children: [] },
      {
        id: 'docs:0.1',
        title: 'Guide',
        children: [
          { id: 'docs:0.1.0', title: 'Deep', path: '/docs/guide/deep', children: [] }
        ]
      }
    ]
  }
]

describe('pure navigation traversal', () => {
  test('normalizes trailing slashes without changing the root path', () => {
    expect(normalizeNavigationPath('/')).toBe('/')
    expect(normalizeNavigationPath('/docs/intro///')).toBe('/docs/intro')
    expect(normalizeNavigationPath('/docs/intro')).toBe('/docs/intro')
  })

  test('finds the first route-bearing page without mutating readonly input', () => {
    const navigation = createNormalizedTree()
    const before = structuredClone(navigation)
    const readonlyTree: readonly DocsItem[] = navigation
    const first = findFirstNavigationPage(readonlyTree)

    expectTypeOf(first).toEqualTypeOf<(DocsItem & { path: string }) | null>()
    expect(first).toEqual(expect.objectContaining({ id: 'docs:0.0', path: '/docs/intro/' }))
    expect(navigation).toEqual(before)
    expect(findFirstNavigationPage(undefined)).toBeNull()
  })

  test('preserves page false semantics for raw trees', () => {
    const first = findFirstNavigationPage([
      {
        title: 'Raw folder',
        path: '/must-not-win',
        page: false,
        children: [{ title: 'Child', path: '/child' }]
      }
    ])

    expect(first).toEqual(expect.objectContaining({ title: 'Child', path: '/child' }))
  })

  test('infers normalized consumer shapes through first-child traversal', () => {
    const [root] = createNormalizedTree()
    const child = findFirstNavigationChild(root)

    expectTypeOf(child).toEqualTypeOf<(DocsItem & { path: string }) | null>()
    expect(child?.id).toBe('docs:0.0')
    expect(findFirstNavigationChild<DocsItem>(null)).toBeNull()
  })

  test('checks descendants and resolves breadcrumb trails with normalized paths', () => {
    const navigation = createNormalizedTree()

    expect(navigationItemContainsPath(navigation[0]!, '/docs/guide/deep/')).toBe(true)
    expect(navigationItemContainsPath(navigation[0]!, '/docs/missing')).toBe(false)
    expect(findNavigationTrail(navigation, '/docs/guide/deep/').map(item => item.id)).toEqual([
      'docs:0',
      'docs:0.1',
      'docs:0.1.0'
    ])
    expect(findNavigationTrail(navigation, '/docs/missing')).toEqual([])
  })

  test('walks depth-first pre-order and prunes only the current branch', () => {
    const navigation = createNormalizedTree()
    const visited: string[] = []

    walkNavigationTree(navigation, (item) => {
      visited.push(item.id)
      if (item.id === 'docs:0.1') return false
    })

    expect(visited).toEqual(['docs:0', 'docs:0.0', 'docs:0.1'])
  })

  test('accepts conventional void visitors', () => {
    const visited: string[] = []
    const visit = (item: DocsItem): void => {
      visited.push(item.id)
    }

    walkNavigationTree(createNormalizedTree(), visit)

    expect(visited).toEqual(['docs:0', 'docs:0.0', 'docs:0.1', 'docs:0.1.0'])
  })
})
