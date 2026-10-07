import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { build, type Plugin } from 'esbuild'
import { compileScript, parse } from 'vue/compiler-sfc'

export interface BrowserBundleReport {
  /** Minified bytes. */
  raw: number
  /** Gzip (level 9) bytes of the minified bundle. */
  gzip: number
  /** Every source module that ended up in the bundle, relative to the cwd. */
  inputs: string[]
}

// Compiles single-file components with an inlined template, which is what a
// production Vite/Nuxt client build ships.
const vueSfc: Plugin = {
  name: 'vue-sfc',
  setup (pluginBuild) {
    pluginBuild.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const { descriptor } = parse(await readFile(path, 'utf8'), { filename: path })
      const script = compileScript(descriptor, { id: path, inlineTemplate: true, isProd: true })
      return { contents: script.content, loader: 'ts', resolveDir: path.slice(0, path.lastIndexOf('/')) }
    })
  }
}

/**
 * Bundles one entry for the browser the way an application client build would
 * (minified, tree-shaken, `vue` external) and reports its transfer size.
 */
export async function measureBrowserBundle (entry: string): Promise<BrowserBundleReport> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    external: ['vue'],
    metafile: true,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [vueSfc]
  })
  const code = result.outputFiles[0]!.contents
  return {
    raw: code.byteLength,
    gzip: gzipSync(code, { level: 9 }).byteLength,
    inputs: Object.keys(result.metafile.inputs)
  }
}
