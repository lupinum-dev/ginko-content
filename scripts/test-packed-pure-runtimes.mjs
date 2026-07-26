import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'
import { chromium } from 'playwright-core'

import { runPureRuntimeProbe } from './lib/pure-runtime-probe.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function resolveTarball() {
  const explicit = option('--tarball')
  if (explicit) return resolve(repoRoot, explicit)
  const directory = resolve(repoRoot, option('--tarball-dir') ?? '.pack')
  const tarballs = existsSync(directory)
    ? readdirSync(directory).filter((file) => file.endsWith('.tgz'))
    : []
  if (tarballs.length !== 1) {
    throw new Error(`Expected one packed Ginko Content tarball in ${directory}, found ${tarballs.length}.`)
  }
  return resolve(directory, tarballs[0])
}

function resolveChromiumExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean)
  const executable = candidates.find((candidate) => existsSync(candidate))
  if (!executable) {
    throw new Error(
      'No Chromium V8 runtime found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or install Chromium.',
    )
  }
  return executable
}

function assertPureGraph(metafile) {
  const forbidden = /(?:^|[/\\])(?:node_modules[/\\])?(?:@cloudflare|convex|h3|nitropack|nuxt)(?:[/\\]|$)|(?:^|[/\\])node:/i
  const offenders = Object.keys(metafile.inputs).filter((input) => forbidden.test(input))
  for (const output of Object.values(metafile.outputs)) {
    for (const dependency of output.imports) {
      if (forbidden.test(dependency.path)) offenders.push(dependency.path)
    }
  }
  if (offenders.length > 0) {
    throw new Error(`Pure runtime graph contains forbidden imports:\n${offenders.join('\n')}`)
  }
}

async function loadPackedApi(packageRoot) {
  const load = async (path) => await import(pathToFileURL(resolve(packageRoot, path)).href)
  return {
    ...(await load('dist/public/data-source.js')),
    ...(await load('dist/public/navigation.js')),
    ...(await load('dist/portability/index.js')),
    ...(await load('dist/testing/portability-contract.js')),
  }
}

async function runWorkerProbe(packageRoot, tempRoot) {
  const entry = resolve(tempRoot, 'worker-entry.mjs')
  const bundle = resolve(tempRoot, 'worker-bundle.js')
  const helper = resolve(repoRoot, 'scripts/lib/pure-runtime-probe.mjs')
  writeFileSync(
    entry,
    [
      `import * as dataSource from ${JSON.stringify(resolve(packageRoot, 'dist/public/data-source.js'))}`,
      `import * as navigation from ${JSON.stringify(resolve(packageRoot, 'dist/public/navigation.js'))}`,
      `import * as portability from ${JSON.stringify(resolve(packageRoot, 'dist/portability/index.js'))}`,
      `import * as testing from ${JSON.stringify(resolve(packageRoot, 'dist/testing/portability-contract.js'))}`,
      `import { runPureRuntimeProbe } from ${JSON.stringify(helper)}`,
      'globalThis.onmessage = async () => {',
      '  try {',
      '    const result = await runPureRuntimeProbe({ ...dataSource, ...navigation, ...portability, ...testing })',
      "    globalThis.postMessage({ ok: true, result, runtime: { worker: typeof WorkerGlobalScope !== 'undefined', document: typeof document } })",
      '  } catch (error) {',
      "    globalThis.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })",
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  const built = await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    metafile: true,
    write: true,
    logLevel: 'silent',
  })
  assertPureGraph(built.metafile)

  const browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: true,
  })
  try {
    const page = await browser.newPage()
    const source = readFileSync(bundle, 'utf8')
    return await page.evaluate(
      (workerSource) =>
        new Promise((resolveResult, reject) => {
          const url = URL.createObjectURL(
            new Blob([workerSource], { type: 'text/javascript' }),
          )
          const worker = new Worker(url)
          worker.onmessage = (event) => {
            worker.terminate()
            URL.revokeObjectURL(url)
            resolveResult(event.data)
          }
          worker.onerror = (event) => {
            worker.terminate()
            URL.revokeObjectURL(url)
            reject(new Error(event.message))
          }
          worker.postMessage(null)
        }),
      source,
    )
  } finally {
    await browser.close()
  }
}

async function main() {
  const tarball = resolveTarball()
  if (!existsSync(tarball)) throw new Error(`Packed tarball does not exist: ${tarball}`)
  const expectedHash = option('--sha256')?.toLowerCase()
  const actualHash = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  if (expectedHash && expectedHash !== actualHash) {
    throw new Error(`Packed tarball SHA-256 mismatch: expected ${expectedHash}, received ${actualHash}.`)
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'ginko-pure-runtimes-'))
  try {
    const extractRoot = resolve(tempRoot, 'extract')
    mkdirSync(extractRoot)
    execFileSync('tar', ['-xzf', tarball, '-C', extractRoot], { stdio: 'pipe' })
    const packageRoot = resolve(extractRoot, 'package')
    symlinkSync(
      resolve(repoRoot, 'packages/content/node_modules'),
      resolve(packageRoot, 'node_modules'),
      'junction',
    )

    const nodeResult = await runPureRuntimeProbe(await loadPackedApi(packageRoot))
    const workerResult = await runWorkerProbe(packageRoot, tempRoot)
    if (
      !workerResult ||
      workerResult.ok !== true ||
      workerResult.runtime?.worker !== true ||
      workerResult.runtime?.document !== 'undefined' ||
      JSON.stringify(workerResult.result) !== JSON.stringify(nodeResult)
    ) {
      throw new Error(`Worker V8 probe did not match Node: ${JSON.stringify(workerResult)}`)
    }
    writeFileSync(
      resolve(dirname(tarball), 'release-lane-pure-runtimes.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        status: 'passed',
        sha256: actualHash,
        node: process.version,
        runtimes: ['node', 'chromium-worker']
      }, null, 2)}\n`,
    )
    console.log(
      `Packed pure runtime probes passed: sha256=${actualHash}, vectors=${nodeResult.vectorCount}, codec=${nodeResult.canonicalKey}.`,
    )
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
