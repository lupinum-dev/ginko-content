import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { registerRuntimeImports, registerUserContentComponents } from '../../packages/content/src/module/runtime-assets'

const kitMocks = vi.hoisted(() => ({
  addImports: vi.fn(),
  addServerImports: vi.fn(),
  addComponentsDir: vi.fn(),
  addPlugin: vi.fn(),
  addTypeTemplate: vi.fn()
}))

vi.mock('@nuxt/kit', () => kitMocks)

const createNuxt = (layers: string[]) => {
  const hooks = new Map<string, Array<(payload: any) => void>>()

  return {
    nuxt: {
      options: {
        _layers: layers.map(srcDir => ({ config: { srcDir } }))
      },
      hook(name: string, handler: (payload: any) => void) {
        hooks.set(name, [...(hooks.get(name) || []), handler])
      }
    },
    hooks
  }
}

describe('runtime asset contracts', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
    vi.clearAllMocks()
  })

  test('does not auto-import useContentSearch because Nuxt UI owns the same composable name', () => {
    registerRuntimeImports(path => `/runtime/${path}`)

    const imports = kitMocks.addImports.mock.calls.flatMap(([items]) => items)
    expect(imports).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'useContentPage', as: 'useContentPage' }),
      expect.objectContaining({ name: 'useContentSearchData', as: 'useContentSearchData' }),
      expect.objectContaining({ name: 'useContentSearchResults', as: 'useContentSearchResults' })
    ]))
    expect(imports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'useContentSearch', as: 'useContentSearch' })
    ]))
  })

  test('does not auto-import low-level query primitives into app code', () => {
    registerRuntimeImports(path => `/runtime/${path}`)

    const imports = kitMocks.addImports.mock.calls.flatMap(([items]) => items)
    expect(imports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'one', as: 'one' }),
      expect.objectContaining({ name: 'many', as: 'many' }),
      expect.objectContaining({ name: 'paginate', as: 'paginate' }),
      expect.objectContaining({ name: 'backlinks', as: 'backlinks' }),
      expect.objectContaining({ name: 'resolveOne', as: 'resolveOne' }),
      expect.objectContaining({ name: 'variants', as: 'variants' }),
      expect.objectContaining({ name: 'tree', as: 'tree' }),
      expect.objectContaining({ name: 'neighbors', as: 'neighbors' })
    ]))
    expect(imports).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'useContentPage', as: 'useContentPage' }),
      expect.objectContaining({ name: 'useContentMany', as: 'useContentMany' }),
      expect.objectContaining({ name: 'useContentTree', as: 'useContentTree' }),
      expect.objectContaining({ name: 'useContentNavigation', as: 'useContentNavigation' })
    ]))
  })

  test('registers user content component dirs as non-global and preserves app override order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'content-runtime-assets-'))
    const baseLayer = join(root, 'base')
    const appLayer = join(root, 'app')
    tempDirs.push(root)

    await mkdir(join(baseLayer, 'components/content'), { recursive: true })
    await mkdir(join(appLayer, 'components/content'), { recursive: true })

    const { nuxt, hooks } = createNuxt([baseLayer, appLayer])
    await registerUserContentComponents(nuxt as any, join)

    const dirs: Array<Record<string, unknown>> = []
    for (const handler of hooks.get('components:dirs') || []) {
      handler(dirs)
    }

    expect(dirs).toEqual([
      {
        path: join(appLayer, 'components/content'),
        global: false,
        pathPrefix: false,
        prefix: ''
      },
      {
        path: join(baseLayer, 'components/content'),
        global: false,
        pathPrefix: false,
        prefix: ''
      }
    ])
  })

  test('skips missing user content component dirs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'content-runtime-assets-'))
    const baseLayer = join(root, 'base')
    const appLayer = join(root, 'app')
    tempDirs.push(root)

    await mkdir(join(appLayer, 'components/content'), { recursive: true })

    const { nuxt, hooks } = createNuxt([baseLayer, appLayer])
    await registerUserContentComponents(nuxt as any, join)

    const dirs: Array<Record<string, unknown>> = []
    for (const handler of hooks.get('components:dirs') || []) {
      handler(dirs)
    }

    expect(dirs).toEqual([
      {
        path: join(appLayer, 'components/content'),
        global: false,
        pathPrefix: false,
        prefix: ''
      }
    ])
  })

})
