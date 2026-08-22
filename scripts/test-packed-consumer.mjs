import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

import { parsePackageManagerVersion } from './release/artifact.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packedFixtureDir = resolve(repoRoot, 'test/consumer-fixtures/packed-app')
const pagefindFixtureDir = resolve(repoRoot, 'test/consumer-fixtures/pagefind-app')
const markdownPluginsFixtureDir = resolve(repoRoot, 'test/consumer-fixtures/markdown-plugins-app')
const cliArgs = process.argv.slice(2)

function resolveChromiumExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter(Boolean)
  const executable = candidates.find(candidate => existsSync(candidate))
  if (!executable) {
    throw new Error('No Chromium executable found for the packed optional-plugin browser check.')
  }
  return executable
}

function optionValue(name, fallback) {
  const index = cliArgs.indexOf(name)
  return index === -1 ? fallback : cliArgs[index + 1]
}

const packageManager = optionValue('--package-manager', 'pnpm')
if (!['pnpm', 'npm'].includes(packageManager)) {
  throw new Error(`Unsupported package manager ${packageManager}; expected pnpm or npm.`)
}
const nuxtVersion = optionValue(
  '--nuxt-version',
  process.env.GINKO_CONSUMER_NUXT_VERSION || '4.5.1'
)

function resolveReleaseTarball() {
  const explicit = optionValue('--tarball')
  if (explicit) {
    const tarball = resolve(repoRoot, explicit)
    if (!existsSync(tarball)) throw new Error(`Release tarball does not exist: ${tarball}`)
    return tarball
  }

  const directory = resolve(repoRoot, optionValue('--tarball-dir', '.pack'))
  const tarballs = existsSync(directory)
    ? readdirSync(directory).filter(file => file.endsWith('.tgz'))
    : []
  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one prebuilt release tarball in ${directory}, found ${tarballs.length}. Run pnpm release:pack first.`)
  }
  return resolve(directory, tarballs[0])
}

// The root module export and client/server facades are verified from Nuxt
// config, generated Vue, and Nitro files below. They depend on Nuxt/Nitro
// virtual imports and are not expected to be runtime-neutral bare Node entry
// points.

const expectedDeclarations = [
  'dist/module.d.mts',
  'dist/config.d.mts',
  'dist/public/client.d.ts',
  'dist/public/server.d.ts',
  'dist/public/provider.d.ts',
  'dist/public/data-source.d.ts',
  'dist/public/navigation.d.ts',
  'dist/portability/index.d.ts',
  'dist/portability-node/index.d.ts',
  'dist/runtime/app/composables/toc.d.ts',
  'dist/public/agent.d.ts',
  'dist/runtime/transformers/define.d.ts',
  'dist/cms-contract/index.d.ts',
  'dist/cms-contract-node/index.d.ts',
  'dist/testing/provider-fixture.d.ts',
  'dist/testing/provider-contract.d.ts',
  'dist/testing/data-source-contract.d.ts',
  'dist/testing/portability-contract.d.ts',
  'dist/types/query.d.ts'
]

function run(command, args, cwd, options = {}) {
  try {
    execFileSync(command, args, {
      cwd,
      env: {
        ...process.env,
        ...(packageManager === 'pnpm' ? { npm_config_verify_deps_before_run: 'false' } : {}),
        ...options.env
      },
      stdio: options.stdio || 'inherit',
      shell: process.platform === 'win32'
    })
  } catch (error) {
    const commandText = [command, ...args].join(' ')
    throw new Error(`Command failed in ${cwd}: ${commandText}`, { cause: error })
  }
}

function runAndCapture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      ...(packageManager === 'pnpm' ? { npm_config_verify_deps_before_run: 'false' } : {})
    },
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`

  if (result.status !== 0) {
    throw new Error(`Command failed in ${cwd}: ${[command, ...args].join(' ')}\n${output}`)
  }

  return output
}

function runAndRejectOutput(command, args, cwd, forbiddenPatterns) {
  const output = runAndCapture(command, args, cwd)

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(output)) {
      throw new Error(`Command emitted forbidden output in ${cwd}: ${[command, ...args].join(' ')}\n${output}`)
    }
  }
}

function packageExec(command, args, cwd, options = {}) {
  const commandArgs = packageManager === 'pnpm'
    ? ['exec', command, ...args]
    : ['exec', '--', command, ...args]
  run(packageManager, commandArgs, cwd, options)
}

function packageExecAndRejectOutput(command, args, cwd, forbiddenPatterns) {
  const commandArgs = packageManager === 'pnpm'
    ? ['exec', command, ...args]
    : ['exec', '--', command, ...args]
  runAndRejectOutput(packageManager, commandArgs, cwd, forbiddenPatterns)
}

function packageExecAndCapture(command, args, cwd) {
  const commandArgs = packageManager === 'pnpm'
    ? ['exec', command, ...args]
    : ['exec', '--', command, ...args]
  return runAndCapture(packageManager, commandArgs, cwd)
}

function assertNoWorkspaceRanges(tarball, tempRoot) {
  const extractDir = resolve(tempRoot, 'extract')
  mkdirSync(extractDir, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', extractDir], repoRoot, { stdio: 'pipe' })

  const manifestPath = resolve(extractDir, 'package/package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Packed tarball is missing package/package.json: ${tarball}`)
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const offenders = []
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(manifest[field] || {})) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        offenders.push(`${field}.${name}=${range}`)
      }
    }
  }

  if (offenders.length) {
    throw new Error(`Packed tarball contains workspace ranges:\n${offenders.map(item => `  - ${item}`).join('\n')}`)
  }
  for (const peer of ['beautiful-mermaid', 'katex']) {
    if (typeof manifest.peerDependencies?.[peer] !== 'string' || manifest.peerDependenciesMeta?.[peer]?.optional !== true) {
      throw new Error(`Packed tarball does not declare optional Markdown peer "${peer}".`)
    }
  }
}

function assertDeclarations(appDir) {
  const packageDir = resolve(appDir, 'node_modules/@lupinum/ginko-content')
  const missing = expectedDeclarations
    .map(file => resolve(packageDir, file))
    .filter(file => !existsSync(file))

  if (missing.length) {
    throw new Error(`Installed package is missing declarations:\n${missing.map(file => `  - ${file}`).join('\n')}`)
  }
}

async function waitForServer(child, baseURL) {
  let output = ''
  child.stdout?.on('data', chunk => { output += chunk.toString() })
  child.stderr?.on('data', chunk => { output += chunk.toString() })

  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Packed consumer server exited early:\n${output}`)
    }

    try {
      const response = await fetch(baseURL)
      if (response.ok) {
        return
      }
    } catch {
      // Wait for server boot.
    }

    await new Promise(resolve => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for packed consumer server:\n${output}`)
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return
  }

  child.kill('SIGTERM')

  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  child.kill('SIGKILL')
}

async function withProductionServer({ cwd, port }, verify) {
  const baseURL = `http://127.0.0.1:${port}`
  const server = spawn('node', ['.output/server/index.mjs'], {
    cwd,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'production'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitForServer(server, baseURL)
    return await verify(baseURL)
  } finally {
    await stopServer(server)
  }
}

function verifyBaseConsumerBuild(appDir) {
  assertDeclarations(appDir)
  run('node', ['scripts/import-public-subpaths.mjs'], appDir)
  packageExec('nuxi', ['prepare'], appDir)
  packageExec('nuxi', ['typecheck'], appDir)
  packageExecAndRejectOutput('nuxt', ['build'], appDir, [
    /could not be resolved[\s\S]*treating it as an external dependency/i,
    /\bNUXT_E\d{4}\b/
  ])
  const prerenderedContentApiDir = resolve(appDir, '.output/public/api/_content')
  const prerenderedContentApiFiles = existsSync(prerenderedContentApiDir)
    ? readdirSync(prerenderedContentApiDir, { recursive: true }).map(String)
    : []
  if (
    !prerenderedContentApiFiles.some(path => path.startsWith('query/')) ||
    !prerenderedContentApiFiles.some(path => path.startsWith('navigation/'))
  ) {
    throw new Error('Packed consumer surround() did not prerender both query and navigation API dependencies.')
  }

  const cliHelp = packageExecAndCapture('ginko-content', ['--help'], appDir)
  if (!cliHelp.includes('validate [root]')) {
    throw new Error(`Packed CLI help does not expose content validation:\n${cliHelp}`)
  }
}

function verifyPagefindConsumer(appDir, tempRoot) {
  const filesystemDir = resolve(tempRoot, 'filesystem-check')
  cpSync(pagefindFixtureDir, filesystemDir, { recursive: true })
  symlinkSync(resolve(appDir, 'node_modules'), resolve(filesystemDir, 'node_modules'), 'junction')
  packageExecAndRejectOutput('nuxt', ['build'], filesystemDir, [
    /could not be resolved[\s\S]*treating it as an external dependency/i,
    /\bNUXT_E\d{4}\b/
  ])

  const pagefindDir = resolve(filesystemDir, '.output/public/pagefind')
  const manifestPath = resolve(pagefindDir, 'ginko-locales.json')
  if (!existsSync(resolve(pagefindDir, 'pagefind.js')) || !existsSync(manifestPath)) {
    throw new Error('Packed consumer build did not emit Pagefind entry and locale manifest artifacts')
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.version !== 1 || manifest.defaultLocale !== 'en' || manifest.indexes?.en !== 'pagefind.js') {
    throw new Error(`Packed consumer build emitted an invalid Pagefind locale manifest:\n${JSON.stringify(manifest)}`)
  }
}

function installOptionalMarkdownPeers(appDir) {
  for (const peer of ['beautiful-mermaid', 'katex']) {
    if (existsSync(resolve(appDir, 'node_modules', peer))) {
      throw new Error(`Base packed consumer unexpectedly installed disabled optional peer "${peer}".`)
    }
  }
  const specs = [
    `beautiful-mermaid@${process.env.GINKO_CONSUMER_BEAUTIFUL_MERMAID_VERSION || '^1.1.3'}`,
    `katex@${process.env.GINKO_CONSUMER_KATEX_VERSION || '^0.17.0'}`
  ]
  if (packageManager === 'pnpm') {
    run('pnpm', ['add', '--save-exact', ...specs], appDir)
  } else {
    run('npm', ['install', '--save-exact', '--no-audit', '--no-fund', ...specs], appDir)
  }
}

async function verifyMarkdownPluginConsumer(appDir) {
  // Keep this fixture below the installed consumer so Node resolves through
  // the real parent node_modules tree.
  const fixtureDir = resolve(appDir, 'markdown-plugins-check')
  cpSync(markdownPluginsFixtureDir, fixtureDir, { recursive: true })
  packageExecAndRejectOutput('nuxt', ['build'], fixtureDir, [
    /could not be resolved[\s\S]*treating it as an external dependency/i,
    /\bNUXT_E\d{4}\b/
  ])

  const browserChunksDir = resolve(fixtureDir, '.output/public/_nuxt')
  const browserChunkSource = readdirSync(browserChunksDir, { recursive: true })
    .map(String)
    .filter(path => path.endsWith('.js'))
    .map(path => readFileSync(resolve(browserChunksDir, path), 'utf8'))
    .join('\n')
  if (/import\(["'](?:comark|@comark\/vue)\//.test(browserChunkSource)) {
    throw new Error('Packed optional-plugin browser chunks retained a bare Comark package import.')
  }
  if (browserChunkSource.includes('custom-markdown')) {
    throw new Error('Packed optional-plugin browser chunks imported the server-only custom parser plugin.')
  }

  await withProductionServer({ cwd: fixtureDir, port: 4600 }, async (baseURL) => {
    const response = await fetch(baseURL)
    const html = await response.text()
    const hasKatexSSR = html.includes('katex')
    const hasMermaidSSR = html.includes('class="mermaid')
    const hasCustomPluginSSR = html.includes('Custom parser plugin active')
    if (!response.ok || !hasKatexSSR || !hasMermaidSSR || !hasCustomPluginSSR) {
      throw new Error(`Packed optional-plugin SSR failed: status=${response.status} katex=${hasKatexSSR} mermaid=${hasMermaidSSR} custom=${hasCustomPluginSSR}\n${html.slice(0, 2000)}`)
    }

    const browser = await chromium.launch({ executablePath: resolveChromiumExecutable(), headless: true })
    try {
      const page = await browser.newPage()
      const failures = []
      page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error' || /hydration/i.test(message.text())) {
          failures.push(`console ${message.type()}: ${message.text()}`)
        }
      })
      page.on('requestfailed', request => failures.push(`request failed: ${request.failure()?.errorText || 'unknown'} ${request.url()}`))
      const navigation = await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
      await page.locator('.mermaid svg').waitFor({ timeout: 30_000 })
      if (navigation?.status() !== 200 || await page.locator('.katex').count() === 0 || failures.length) {
        throw new Error(`Packed optional-plugin browser check failed:\n${failures.join('\n')}`)
      }
    } finally {
      await browser.close()
    }
  })
}

async function readJsonResponse(response, label) {
  const body = await response.text()
  if (!response.ok) throw new Error(`${label} failed: ${response.status}\n${body.slice(0, 500)}`)
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`${label} did not return JSON: ${response.headers.get('content-type')}`)
  }
  if (!body) throw new Error(`${label} returned an unexpected empty body`)
  return JSON.parse(body)
}

async function verifyLiveApiContract(appDir) {
  await withProductionServer({ cwd: appDir, port: 4599 }, async (baseURL) => {
    const pageResponse = await fetch(baseURL)
    const html = await pageResponse.text()
    if (!pageResponse.ok || !html.includes('Package Consumer Page') || !html.includes('Second Page')) {
      throw new Error(`Packed consumer page failed: ${pageResponse.status}\n${html.slice(0, 500)}`)
    }
    const leakedServerRuntimeMarkers = [
      '~/server/providers/memory',
      'Packed package consumer smoke app.',
      '"provider":"memory"',
      '"source":"*.md"'
    ].filter(marker => html.includes(marker))
    if (leakedServerRuntimeMarkers.length) {
      throw new Error(`Packed consumer serialized server-only runtime config into the public payload: ${leakedServerRuntimeMarkers.join(', ')}`)
    }

    const cachePageResponse = await fetch(`${baseURL}/cache-live`)
    const cachePageBody = await cachePageResponse.text()
    if (!cachePageResponse.ok || !cachePageBody.includes('Package Consumer Page') || !cachePageResponse.headers.get('cache-control')?.includes('max-age=60')) {
      throw new Error(`Live SSR page omitted provider cache metadata: ${cachePageResponse.status} ${cachePageResponse.headers.get('cache-control')}`)
    }

    const encodeQuery = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const queryUrl = params => `${baseURL}/api/_content/query/packed/${encodeQuery(params)}.json`
    const foundBody = await readJsonResponse(await fetch(queryUrl({ collection: 'pages', where: [{ path: '/' }], first: true })), 'found first query')
    if (foundBody.result?.title !== 'Package Consumer Page') {
      throw new Error(`Found first query returned an invalid envelope: ${JSON.stringify(foundBody)}`)
    }
    const missingResponse = await fetch(queryUrl({ collection: 'pages', where: [{ path: '/missing' }], first: true }))
    const missingBody = await readJsonResponse(missingResponse, 'missing first query')
    if (missingResponse.status !== 200 || Object.keys(missingBody).join() !== 'result' || missingBody.result !== null) {
      throw new Error(`Missing first query did not return { result: null }: ${JSON.stringify(missingBody)}`)
    }

    const listBody = await readJsonResponse(await fetch(queryUrl({ collection: 'pages', limit: 2 })), 'list query')
    if (!Array.isArray(listBody.result) || listBody.result.length !== 2) {
      throw new Error(`List query returned an invalid envelope: ${JSON.stringify(listBody)}`)
    }
    const serverQueryBody = await readJsonResponse(await fetch(`${baseURL}/api/query-contract`), 'server query contract')
    if (
      serverQueryBody.found?.title !== 'Package Consumer Page' ||
      serverQueryBody.missing !== null ||
      serverQueryBody.list?.length !== 2 ||
      serverQueryBody.cursorFirst?.endCursor !== 'page-2' ||
      serverQueryBody.cursorSecond?.data?.[0]?.title !== 'Second Page'
    ) {
      throw new Error(`Server one/many/paginate contract failed: ${JSON.stringify(serverQueryBody)}`)
    }
    const ofetchBody = await readJsonResponse(await fetch(`${baseURL}/api/ofetch-contract`), '$fetch query contract')
    if (ofetchBody.result !== null) throw new Error(`$fetch did not preserve the missing result envelope: ${JSON.stringify(ofetchBody)}`)

    const missingPageResponse = await fetch(`${baseURL}/missing`)
    const missingPageHtml = await missingPageResponse.text()
    if (!missingPageResponse.ok || !missingPageHtml.includes('Missing document')) {
      throw new Error(`Client-facing missing query failed: ${missingPageResponse.status}\n${missingPageHtml.slice(0, 500)}`)
    }

    const providerFailureResponse = await fetch(queryUrl({ collection: 'pages', where: [{ path: '/provider-failure' }], first: true }))
    const providerFailureText = await providerFailureResponse.text()
    if (providerFailureResponse.status !== 502 || !providerFailureText.includes('BACKEND_FAILURE') || providerFailureText.includes('memory')) {
      throw new Error(`Provider failure was not sanitized: ${providerFailureResponse.status}\n${providerFailureText.slice(0, 500)}`)
    }

    const navigationResponse = await fetch(`${baseURL}/api/_content/navigation?collection=pages`)
    const navigationBody = await navigationResponse.text()
    if (!navigationResponse.ok || !navigationBody.includes('"path":"/"')) {
      throw new Error(`Packed consumer content API failed: ${navigationResponse.status}\n${navigationBody.slice(0, 500)}`)
    }
    const searchBody = await readJsonResponse(await fetch(`${baseURL}/api/_content/search?q=Package`), 'search query')
    if (!Array.isArray(searchBody)) throw new TypeError(`Packed consumer search returned an invalid response: ${JSON.stringify(searchBody)}`)
    const siteDataBody = await readJsonResponse(await fetch(`${baseURL}/api/_content/site-data?key=settings`), 'site-data query')
    if (siteDataBody.data?.fixture !== 'packed-memory') {
      throw new Error(`Packed consumer site data did not use the in-memory provider: ${JSON.stringify(siteDataBody)}`)
    }
    const sitemapApiBody = await readJsonResponse(await fetch(`${baseURL}/api/_content/sitemap`), 'sitemap route enumeration')
    if (!Array.isArray(sitemapApiBody) || sitemapApiBody.length !== 2) {
      throw new Error(`Packed consumer route enumeration lost routes: ${JSON.stringify(sitemapApiBody)}`)
    }
    const importSmokeResponse = await fetch(`${baseURL}/api/import-smoke`)
    const importSmokeBody = await importSmokeResponse.text()
    if (!importSmokeResponse.ok || !importSmokeBody.includes('"agentRegistry":"function"')) {
      throw new Error(`Packed consumer Nuxt import smoke failed: ${importSmokeResponse.status}\n${importSmokeBody.slice(0, 500)}`)
    }
  })
}

function verifyGeneratedOutputs(appDir) {
  const sitemapPath = resolve(appDir, '.output/public/sitemap.xml')
  if (!existsSync(sitemapPath)) throw new Error('Packed consumer build did not emit .output/public/sitemap.xml')
  const sitemap = readFileSync(sitemapPath, 'utf8')
  if (!sitemap.includes('https://packed-consumer.example.test/')) {
    throw new Error(`Packed consumer sitemap is missing the content page URL:\n${sitemap.slice(0, 500)}`)
  }

  const llmsPath = resolve(appDir, '.output/public/llms.txt')
  const rawMarkdownPath = resolve(appDir, '.output/public/raw/index.md')
  if (!existsSync(llmsPath) || !existsSync(rawMarkdownPath)) {
    throw new Error('Packed consumer build did not emit agent markdown outputs')
  }
  const llms = readFileSync(llmsPath, 'utf8')
  const rawMarkdown = readFileSync(rawMarkdownPath, 'utf8')
  if (!llms.includes('/raw/index.md') || !rawMarkdown.includes('# Package Consumer Page')) {
    throw new Error(`Packed consumer agent markdown output is invalid:\n${llms.slice(0, 300)}\n${rawMarkdown.slice(0, 300)}`)
  }
}

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ginko-packed-consumer-'))

  try {
    const appDir = resolve(tempRoot, 'app')
    cpSync(packedFixtureDir, appDir, { recursive: true })
    const tarball = resolveReleaseTarball()
    const tarballSha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex')
    const packageManagerVersion = parsePackageManagerVersion(
      runAndCapture(packageManager, ['--version'], appDir),
      packageManager,
    )
    console.log(`Testing exact release tarball with ${packageManager}: ${tarball} (sha256 ${tarballSha256})`)
    assertNoWorkspaceRanges(tarball, tempRoot)
    const installedTarball = join(tempRoot, 'artifacts', `${tarballSha256}.tgz`)
    mkdirSync(resolve(installedTarball, '..'), { recursive: true })
    copyFileSync(tarball, installedTarball)

    writeFileSync(resolve(appDir, 'package.json'), JSON.stringify({
      type: 'module',
      private: true,
      scripts: {
        typecheck: 'nuxi typecheck',
        build: 'nuxt build'
      },
      dependencies: {
        '@lupinum/ginko-content': `file:${installedTarball}`,
        '@nuxtjs/sitemap': process.env.GINKO_CONSUMER_SITEMAP_VERSION || '8.0.15',
        '@types/node': process.env.GINKO_CONSUMER_NODE_TYPES_VERSION || '^24.0.0',
        nuxt: nuxtVersion,
        pagefind: process.env.GINKO_CONSUMER_PAGEFIND_VERSION || '1.5.2',
        typescript: '6.0.3',
        vue: process.env.GINKO_CONSUMER_VUE_VERSION || '^3.5.35',
        'vue-tsc': '3.2.9',
        vitest: process.env.GINKO_CONSUMER_VITEST_VERSION || '4.1.6'
      }
    }, null, 2))

    if (packageManager === 'pnpm') {
      run('pnpm', ['install', '--frozen-lockfile=false', '--config.dangerously-allow-all-builds=true'], appDir)
    } else {
      run('npm', ['install', '--no-audit', '--no-fund'], appDir)
    }
    verifyBaseConsumerBuild(appDir)
    verifyPagefindConsumer(appDir, tempRoot)
    installOptionalMarkdownPeers(appDir)

    await verifyMarkdownPluginConsumer(appDir)
    await verifyLiveApiContract(appDir)
    verifyGeneratedOutputs(appDir)

    writeFileSync(
      resolve(dirname(tarball), `release-lane-consumer-${packageManager}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        status: 'passed',
        sha256: tarballSha256,
        node: process.version,
        packageManager,
        packageManagerVersion
      }, null, 2)}\n`
    )
    console.log(`Packed consumer ${packageManager} ${packageManagerVersion} test passed.`)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
