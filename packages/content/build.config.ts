import { defineBuildConfig } from 'unbuild'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { globby } from 'globby'

const mkdistEntries = [
  ['src/runtime/', 'dist/runtime'],
  ['src/core/', 'dist/core'],
  ['src/features/', 'dist/features'],
  ['src/integrations/', 'dist/integrations'],
  ['src/parsers/', 'dist/parsers'],
  ['src/public/', 'dist/public'],
  ['src/storage/', 'dist/storage'],
  ['src/testing/', 'dist/testing'],
  // `src/types/` MUST be emitted: `public/client.ts` re-exports types via
  // `export type { ... } from '../types/query.js'`. Without this entry,
  // `dist/types/query.d.ts` doesn't exist and TypeScript silently resolves
  // every imported type (OneOptions, QueryWhere, LocalizedDoc, ...) to `any`,
  // which collapses the entire ADR-0016 type-required-locale guarantee.
  ['src/types/', 'dist/types'],
  // `src/cms-contract/` is the pure subpath ginko-cms imports from inside
  // its Convex component. Must stay free of Node/Nuxt/h3/nitropack runtime
  // deps; if a transitive import drags one in, the CMS build fails loudly.
  ['src/cms-contract/', 'dist/cms-contract'],
  // Pure portability codecs share the runtime-neutral contract/hash boundary.
  ['src/portability/', 'dist/portability'],
  // `src/cms-import/` is the Node-side importer boundary used by ginko-cms
  // migration. It may read filesystem-shaped content, but parsing semantics
  // still live in ginko-content instead of a second CMS parser.
  ['src/cms-import/', 'dist/cms-import']
]

const runtimeExternalPlaceholders = new Set<string>()

const exists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const publishedSpecifier = async (importer: string, specifier: string) => {
  if (!specifier.startsWith('.')) return specifier
  if (await exists(resolve(dirname(importer), `${specifier}.js`))) return `${specifier}.js`
  if (await exists(resolve(dirname(importer), specifier, 'index.js')))
    return `${specifier}/index.js`
  return specifier
}

const rewritePublishedRelativeImports = async () => {
  const files = await globby('dist/**/*.{js,mjs}')
  const pattern = /((?:from\s*|import\s*\()(['"]))(\.\.?\/[^'"]+)(\2\)?)/g

  await Promise.all(
    files.map(async file => {
      const source = await readFile(file, 'utf8')
      const matches = [...source.matchAll(pattern)]
      let output = source
      for (const match of matches.reverse()) {
        const specifier = await publishedSpecifier(file, match[3])
        if (specifier === match[3] || match.index === undefined) continue
        const start = match.index + match[1].length
        output = `${output.slice(0, start)}${specifier}${output.slice(start + match[3].length)}`
      }
      if (output !== source) await writeFile(file, output, 'utf8')
    })
  )
}

const ensureRuntimeExternalPlaceholders = async () => {
  for (const [input, outDir] of mkdistEntries) {
    const files = await globby(`${input}**/*.ts`, {
      ignore: ['**/*.d.ts']
    })

    await Promise.all(
      files.map(async file => {
        const output = `${outDir}/${relative(input, file).replace(/\.(ts|vue)$/, '')}`
        await mkdir(dirname(output), { recursive: true })
        await writeFile(output, `export * from './${basename(output)}.js'\n`, 'utf8')
        runtimeExternalPlaceholders.add(output)
      })
    )
  }
}

export default defineBuildConfig({
  failOnWarn: false,
  externals: [
    '#build/types/layouts',
    // The Nuxt module bundle imports helpers emitted by the mkdist entries
    // below. They are package-internal files, not undeclared dependencies.
    /^\.\.\/dist\//
  ],
  entries: [
    'src/module',
    'src/config',
    'src/cli'
  ],
  hooks: {
    'build:prepare' (ctx) {
      ctx.options.entries = ctx.options.entries?.filter(entry => !entry.input?.includes('src/runtime'))
      for (const [input, outDir] of mkdistEntries) {
        ctx.options.entries.push({
          builder: 'mkdist',
          input,
          outDir,
          ext: 'js'
        })
      }
    },
    async 'rollup:options' () {
      await ensureRuntimeExternalPlaceholders()
    },
    async 'build:done'() {
      await rewritePublishedRelativeImports()
      await Promise.all([...runtimeExternalPlaceholders].map(file => rm(file, { force: true })))
      runtimeExternalPlaceholders.clear()
    }
  }
})
