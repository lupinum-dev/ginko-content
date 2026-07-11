import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  generatedContentServerTypeSpecs,
  generatedContentServerValueNames,
  registerContentI18nTemplate,
  registerGeneratedTypes,
  registerRuntimeImports,
  registerUserContentComponents,
  runtimeAppImportSpecs,
  runtimeServerImportSpecs
} from '../../packages/content/src/module/runtime-assets'
import { registerContentComponentsTemplate } from '../../packages/content/src/module/content-components-template'

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

const toNuxtPath = (path: string) => path.replaceAll('\\', '/')

describe('runtime asset contracts', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
    vi.clearAllMocks()
  })

  test('auto-imports useContentPage and the collision-safe Ginko search alias', () => {
    registerRuntimeImports(path => `/runtime/${path}`)

    const imports = kitMocks.addImports.mock.calls.flatMap(([items]) => items)
    expect(imports.map(item => item.name).sort()).toEqual(runtimeAppImportSpecs.map(spec => spec.name).sort())
    expect(imports.map(item => item.name).sort()).toEqual(['useContentPage', 'useContentSearch'])
    expect(imports).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'useContentPage', as: 'useContentPage' }),
      expect.objectContaining({ name: 'useContentSearch', as: 'useGinkoContentSearch' })
    ]))
  })

  test('does not auto-import low-level query primitives or deleted wrappers into app code', () => {
    registerRuntimeImports(path => `/runtime/${path}`)

    const imports = kitMocks.addImports.mock.calls.flatMap(([items]) => items)
    expect(imports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'one', as: 'one' }),
      expect.objectContaining({ name: 'many', as: 'many' }),
      expect.objectContaining({ name: 'paginate', as: 'paginate' }),
      expect.objectContaining({ name: 'backlinks', as: 'backlinks' }),
      expect.objectContaining({ name: 'resolveOne', as: 'resolveOne' }),
      expect.objectContaining({ name: 'surround', as: 'surround' }),
      expect.objectContaining({ name: 'navigation', as: 'navigation' }),
      expect.objectContaining({ name: 'getCollectionPath', as: 'getCollectionPath' }),
      expect.objectContaining({ name: 'querySiteData', as: 'querySiteData' }),
      expect.objectContaining({ name: 'useContentHead', as: 'useContentHead' }),
      expect.objectContaining({ name: 'useContentOne', as: 'useContentOne' }),
      expect.objectContaining({ name: 'useContentMany', as: 'useContentMany' }),
      expect.objectContaining({ name: 'useContentPagination', as: 'useContentPagination' }),
      expect.objectContaining({ name: 'useContentBacklinks', as: 'useContentBacklinks' }),
      expect.objectContaining({ name: 'useContentResolveOne', as: 'useContentResolveOne' }),
      expect.objectContaining({ name: 'useContentVariants', as: 'useContentVariants' }),
      expect.objectContaining({ name: 'useContentTree', as: 'useContentTree' }),
      expect.objectContaining({ name: 'useContentNavigation', as: 'useContentNavigation' }),
      expect.objectContaining({ name: 'useContentNeighbors', as: 'useContentNeighbors' }),
      expect.objectContaining({ name: 'useContentToc', as: 'useContentToc' }),
      expect.objectContaining({ name: 'useContentSwitchLocalePath', as: 'useContentSwitchLocalePath' }),
      expect.objectContaining({ name: 'useContentSearchData', as: 'useContentSearchData' }),
      expect.objectContaining({ name: 'useContentSearchResults', as: 'useContentSearchResults' })
    ]))
  })

  test('generated #content/server types cover registered server auto-imports', () => {
    registerRuntimeImports(path => `/runtime/${path}`)
    registerGeneratedTypes('/content.config.ts', path => `/runtime/${path}`)

    const serverImports = kitMocks.addServerImports.mock.calls.flatMap(([items]) => items)
    expect(serverImports.map(item => item.name).sort()).toEqual(runtimeServerImportSpecs.map(spec => spec.name).sort())

    const contentTypeTemplate = kitMocks.addTypeTemplate.mock.calls
      .map(([template]) => template)
      .find(template => template.filename === 'types/content.d.ts')

    expect(contentTypeTemplate).toBeDefined()
    const contents = contentTypeTemplate!.getContents()
    for (const name of runtimeServerImportSpecs.map(spec => spec.name)) {
      expect(contents).toContain(`  const ${name}: typeof import("/runtime/./server").${name}`)
    }
  })

  test('generated #content/server declarations are complete and explicit', () => {
    registerGeneratedTypes('/content.config.ts', path => `/runtime/quote'/${path}`)

    const contentTypeTemplate = kitMocks.addTypeTemplate.mock.calls
      .map(([template]) => template)
      .find(template => template.filename === 'types/content.d.ts')

    expect(contentTypeTemplate).toBeDefined()
    const contents = contentTypeTemplate!.getContents()
    for (const name of generatedContentServerValueNames) {
      expect(contents).toContain(`  const ${name}: typeof import("/runtime/quote'/./server").${name}`)
    }
    for (const spec of generatedContentServerTypeSpecs) {
      expect(contents).toContain(`  type ${spec.local} = import("/runtime/quote'/./server").${spec.exported}`)
    }
  })

  test('content component template quotes generated loader keys and import paths', () => {
    const templates: Array<{ filename: string, getContents: (context: any) => string }> = []
    registerContentComponentsTemplate((template: any) => {
      templates.push(template)
      return template
    })

    const template = templates.find(item => item.filename === 'content-components.mjs')
    expect(template).toBeDefined()

    const contents = template!.getContents({
      nuxt: {
        options: {
          buildDir: '/app/.nuxt'
        }
      },
      app: {
        components: [
          {
            pascalName: 'Bad-Key',
            filePath: "/app/components/content/Bad'Key.vue",
            global: false
          }
        ]
      }
    })

    expect(contents).toContain(`  "Bad-Key": () => import("./../components/content/Bad'Key.vue")`)
    expect(contents).not.toContain('  Bad-Key:')
  })

  test('fallback content i18n localePath resolves named routes through Nuxt router', () => {
    const templates: Array<{ filename: string, getContents: () => string }> = []
    registerContentI18nTemplate((template: any) => {
      templates.push(template)
      return template
    }, false)

    const template = templates.find(item => item.filename === 'content-i18n.mjs')
    expect(template).toBeDefined()
    const contents = template!.getContents()
    expect(contents).toContain('import { useRouter } from \'#imports\'')
    expect(contents).toContain('const router = useRouter()')
    expect(contents).toContain('return router.resolve({')
    expect(contents).toContain('...(definedRecord(value.params) ? { params: definedRecord(value.params) } : {})')
    expect(contents).toContain('...(definedRecord(value.query) ? { query: definedRecord(value.query) } : {})')
    expect(contents).toContain('...(typeof value.hash === \'string\' ? { hash: value.hash } : {})')
    expect(contents).toContain('if (typeof value === \'string\') return normalizeRoutePath(value)')
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
        path: toNuxtPath(join(appLayer, 'components/content')),
        global: false,
        pathPrefix: false,
        prefix: ''
      },
      {
        path: toNuxtPath(join(baseLayer, 'components/content')),
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
        path: toNuxtPath(join(appLayer, 'components/content')),
        global: false,
        pathPrefix: false,
        prefix: ''
      }
    ])
  })

})
