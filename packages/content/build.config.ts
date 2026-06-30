import { defineBuildConfig } from 'unbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, relative } from 'node:path'
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
  // `src/cms-import/` is the Node-side importer boundary used by ginko-cms
  // migration. It may read filesystem-shaped content, but parsing semantics
  // still live in ginko-content instead of a second CMS parser.
  ['src/cms-import/', 'dist/cms-import'],
  // `src/cms-exchange/` is the portable bidirectional CMS exchange boundary.
  // It reuses cms-import for parsing and adds framework-free render/manifest
  // helpers without pulling in CMS runtime concerns.
  ['src/cms-exchange/', 'dist/cms-exchange']
]

const ensureRuntimeExternalPlaceholders = async () => {
  for (const [input, outDir] of mkdistEntries) {
    const files = await globby(`${input}**/*.ts`, {
      ignore: ['**/*.d.ts']
    })

    await Promise.all(files.map(async (file) => {
      const output = `${outDir}/${relative(input, file).replace(/\.(ts|vue)$/, '')}`
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, `export * from './${basename(output)}.js'\n`, 'utf8')
    }))
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
    }
  }
})
