import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const cliArgs = process.argv.slice(2)

function optionValue(name, fallback) {
  const index = cliArgs.indexOf(name)
  return index === -1 ? fallback : cliArgs[index + 1]
}

const packageManager = optionValue('--package-manager', 'pnpm')
if (!['pnpm', 'npm'].includes(packageManager)) {
  throw new Error(`Unsupported package manager ${packageManager}; expected pnpm or npm.`)
}
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

const nodeImportableSubpaths = [
  '@lupinum/ginko-content/config',
  '@lupinum/ginko-content/navigation',
  '@lupinum/ginko-content/provider',
  '@lupinum/ginko-content/data-source',
  '@lupinum/ginko-content/portability',
  '@lupinum/ginko-content/portability/node',
  '@lupinum/ginko-content/transformers',
  '@lupinum/ginko-content/cms-contract',
  '@lupinum/ginko-content/testing/provider-fixture',
  '@lupinum/ginko-content/testing/provider-contract',
  '@lupinum/ginko-content/testing/data-source-contract',
  '@lupinum/ginko-content/testing/portability-contract'
]

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

function writeFile(path, content) {
  writeFileSync(path, content.trimStart())
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

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ginko-packed-consumer-'))
  let server

  try {
    const appDir = resolve(tempRoot, 'app')
    mkdirSync(appDir, { recursive: true })
    const tarball = resolveReleaseTarball()
    const tarballSha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex')
    const packageManagerVersion = runAndCapture(packageManager, ['--version'], appDir).trim()
    console.log(`Testing exact release tarball with ${packageManager}: ${tarball} (sha256 ${tarballSha256})`)
    assertNoWorkspaceRanges(tarball, tempRoot)
    const installedTarball = join(tempRoot, 'artifacts', `${tarballSha256}.tgz`)
    mkdirSync(resolve(installedTarball, '..'), { recursive: true })
    copyFileSync(tarball, installedTarball)

    writeFile(resolve(appDir, 'package.json'), JSON.stringify({
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
        nuxt: process.env.GINKO_CONSUMER_NUXT_VERSION || '4.4.7',
        pagefind: process.env.GINKO_CONSUMER_PAGEFIND_VERSION || '1.5.2',
        typescript: '6.0.3',
        vue: process.env.GINKO_CONSUMER_VUE_VERSION || '3.5.35',
        'vue-tsc': '3.2.9',
        vitest: process.env.GINKO_CONSUMER_VITEST_VERSION || '4.1.6'
      }
    }, null, 2))

    mkdirSync(resolve(appDir, 'content'), { recursive: true })
    mkdirSync(resolve(appDir, 'pages'), { recursive: true })
    mkdirSync(resolve(appDir, 'server/api'), { recursive: true })
    mkdirSync(resolve(appDir, 'server/plugins'), { recursive: true })
    mkdirSync(resolve(appDir, 'server/providers'), { recursive: true })
    mkdirSync(resolve(appDir, 'scripts'), { recursive: true })

    writeFile(resolve(appDir, 'nuxt.config.ts'), `
      export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content', '@nuxtjs/sitemap'],
        site: {
          url: 'https://packed-consumer.example.test',
          name: 'Packed Consumer'
        },
        routeRules: {
          '/cache-live': { prerender: false }
        },
        content: {
          cache: '~/server/content-cache',
          agent: {
            linkHeaders: true,
            markdownNegotiation: true
          },
          search: {
            engine: 'provider'
          },
          sitemap: true,
          validation: 'report'
        },
        compatibilityDate: '2026-04-14'
      })
    `)

    writeFile(resolve(appDir, 'tsconfig.json'), JSON.stringify({
      extends: './.nuxt/tsconfig.json'
    }, null, 2))

    writeFile(resolve(appDir, 'content.config.ts'), `
      import { defineAgentSection, defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const pages = defineCollection({
        type: 'page',
        source: '*.md',
        agent: {
          section: 'docs',
          markdown: true
        }
      })

      export default defineContentConfig({
        provider: 'memory',
        providers: {
          memory: '~/server/providers/memory'
        },
        agent: {
          site: {
            title: 'Packed Consumer',
            description: 'Packed package consumer smoke app.',
            url: 'https://packed-consumer.example.test',
            defaultLocale: 'en',
            locales: ['en']
          },
          sections: [
            defineAgentSection({ id: 'docs', title: 'Docs', order: 10 })
          ]
        },
        collections: { pages }
      })
    `)

    writeFile(resolve(appDir, 'content/index.md'), `
---
title: Package Consumer Page
---

# Package Consumer Page

The packed package rendered this page.

    `)

    writeFile(resolve(appDir, 'server/providers/memory.ts'), `
      import {
        CONTENT_DATA_SOURCE_LIMITS,
        createContentDataSourceError,
        type ContentDataSource
      } from '@lupinum/ginko-content/data-source'
      import { bindContentProvider } from '@lupinum/ginko-content/provider'

      const documents = [
        {
          collection: 'pages',
          canonicalKey: 'pages:index',
          locale: 'en',
          contentPath: '/',
          body: null,
          title: 'Package Consumer Page'
        },
        {
          collection: 'pages',
          canonicalKey: 'pages:second',
          locale: 'en',
          contentPath: '/second',
          body: null,
          title: 'Second Page'
        }
      ] as const

      const cache = {
        tags: ['content:pages'],
        paths: ['/'],
        maxAge: 60,
        swr: 30,
        etag: 'packed-fixture-v1',
        lastModified: 1_700_000_000_000
      }

      const source = {
        name: 'memory',
        capabilities: {
          protocol: 'ginko-content-data-source/v1',
          query: {
            operators: ['$eq'],
            pagination: ['offset', 'cursor'],
            maxPageSize: CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize
          }
        },
        async query(_context, query) {
          const serialized = JSON.stringify(query.plan)
          if (serialized.includes('/provider-failure')) {
            throw createContentDataSourceError('BACKEND_FAILURE')
          }
          const selected = serialized.includes('/missing')
            ? []
            : serialized.includes('/second')
              ? [documents[1]]
              : [...documents]
          if (query.plan.mode === 'count') return { data: { result: selected.length }, cache }
          if (query.plan.mode === 'first') return { data: { result: selected[0] }, cache }
          if (query.plan.paging?.mode === 'cursor') {
            const start = query.plan.paging.after === 'page-2' ? 1 : 0
            const result = selected.slice(start, start + 1)
            return {
              data: {
                mode: 'cursor',
                result,
                limit: query.plan.limit,
                pageInfo: {
                  endCursor: start === 0 && selected.length > 1 ? 'page-2' : null,
                  hasNext: start === 0 && selected.length > 1
                }
              },
              cache
            }
          }
          const skip = query.plan.paging?.mode === 'offset' ? query.plan.paging.skip : query.plan.skip
          return {
            data: {
              mode: 'offset',
              result: selected.slice(skip, skip + query.plan.limit),
              skip,
              limit: query.plan.limit,
              total: selected.length
            },
            cache
          }
        },
        async navigation() {
          return {
            data: documents.map(document => ({
              title: document.title,
              route: {
                collection: document.collection,
                canonicalKey: document.canonicalKey,
                locale: document.locale,
                contentPath: document.contentPath
              }
            })),
            cache
          }
        },
        async search(_context, request) {
          return {
            data: documents.slice(0, request.limit).map((document, index) => ({
              title: document.title,
              excerpt: 'Packed provider search result',
              score: 1 - index / 10,
              route: {
                collection: document.collection,
                canonicalKey: document.canonicalKey,
                locale: document.locale,
                contentPath: document.contentPath
              }
            })),
            cache
          }
        },
        async siteData(_context, request) {
          return {
            data: {
              key: request.key,
              locale: request.locale ?? null,
              data: { fixture: 'packed-memory' },
              updatedAt: 1_700_000_000_000
            },
            cache
          }
        },
        async routes(_context, request) {
          const start = request.cursor === 'route-2' ? 1 : 0
          const items = documents.slice(start, start + 1).map(document => ({
            collection: document.collection,
            canonicalKey: document.canonicalKey,
            locale: document.locale,
            contentPath: document.contentPath
          }))
          return {
            data: {
              items,
              nextCursor: start === 0 ? 'route-2' : null,
              snapshot: 'packed-route-inventory-v1'
            },
            cache
          }
        }
      } satisfies ContentDataSource<{ requestId: string }>

      export default bindContentProvider({
        source,
        createContext: async () => ({ requestId: 'packed-consumer' })
      })
    `)

    writeFile(resolve(appDir, 'server/content-cache.ts'), `
      import { headersContentCache } from '@lupinum/ginko-content/server'
      export default headersContentCache()
    `)

    writeFile(
      resolve(appDir, 'server/plugins/agent-contract.ts'),
      `
      import {
        agentRawPathForRoute
      } from '@lupinum/ginko-content/agent'

      if (agentRawPathForRoute('/docs/intro') !== '/raw/docs/intro.md') {
        throw new Error('Packed agent path helper export is invalid')
      }

      export default defineNitroPlugin((nitroApp) => {
        nitroApp.hooks.hook('error', (error) => {
          console.error('PACKED_CONSUMER_SERVER_ERROR', error)
        })
      })
    `)

    writeFile(
      resolve(appDir, 'server/data-source-adapter.ts'),
      readFileSync(
        resolve(repoRoot, 'test/fixtures/typecheck/types/data-source-adapter.ts'),
        'utf8'
      )
    )

    writeFile(resolve(appDir, 'pages/index.vue'), `
      <script setup lang="ts">
      import { useContentPage } from '#imports'
      import { pages } from '../content.config'

      const { page } = await useContentPage(pages)
      </script>

      <template>
        <main><h1>{{ page?.title }}</h1></main>
      </template>
    `)

    writeFile(resolve(appDir, 'server/api/query-contract.get.ts'), `
      import { many, one, paginate } from '@lupinum/ginko-content/server'
      import { pages } from '../../content.config'

      export default defineEventHandler(async (event) => ({
        found: await one(event, pages, { by: { path: '/' } }),
        missing: await one(event, pages, { by: { path: '/missing' } }),
        list: await many(event, pages, { limit: 2 }),
        cursorFirst: await paginate(event, pages, { mode: 'cursor', after: null, limit: 1 }),
        cursorSecond: await paginate(event, pages, { mode: 'cursor', after: 'page-2', limit: 1 })
      }))
    `)

    writeFile(resolve(appDir, 'server/api/ofetch-contract.get.ts'), `
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

      export default defineEventHandler(async (event) => {
        const missing = encode({ collection: 'pages', where: [{ path: '/missing' }], first: true })
        return await event.$fetch('/api/_content/query/packed/' + missing + '.json')
      })
    `)

    writeFile(resolve(appDir, 'pages/missing.vue'), `
      <script setup lang="ts">
      import { useContentPage } from '#imports'
      import { pages } from '../content.config'

      const { page } = await useContentPage(pages)
      </script>

      <template><main>{{ page == null ? 'Missing document' : 'Unexpected document' }}</main></template>
    `)

    writeFile(resolve(appDir, 'pages/second.vue'), `
      <script setup lang="ts">
      import { useContentPage } from '#imports'
      import { pages } from '../content.config'

      const { page } = await useContentPage(pages)
      </script>

      <template><main><h1>{{ page?.title }}</h1></main></template>
    `)

    writeFile(resolve(appDir, 'pages/cache-live.vue'), `
      <script setup lang="ts">
      import { one } from '@lupinum/ginko-content/client'
      import { pages } from '../content.config'
      const page = await one(pages, { by: { path: '/' } })
      </script>
      <template><main>{{ page?.title }}</main></template>
    `)

    writeFile(resolve(appDir, 'pages/import-smoke.vue'), `
      <script setup lang="ts">
      import { one, useContentPage, useContentSearch, extractContentToc } from '@lupinum/ginko-content/client'

      void [one, useContentPage, useContentSearch, extractContentToc]
      </script>

      <template>
        <main>
          <h1>Import Smoke</h1>
        </main>
      </template>
    `)

    writeFile(resolve(appDir, 'server/api/import-smoke.get.ts'), `
      import { one, many } from '@lupinum/ginko-content/server'
      import { createAgentMarkdownRegistry } from '@lupinum/ginko-content/agent'

      export default defineEventHandler(() => ({
        server: typeof one,
        many: typeof many,
        agentRegistry: typeof createAgentMarkdownRegistry
      }))
    `)

    writeFile(resolve(appDir, 'scripts/import-public-subpaths.mjs'), `
      const subpaths = ${JSON.stringify(nodeImportableSubpaths, null, 2)}

      for (const subpath of subpaths) {
        console.log(\`Importing \${subpath}\`)
        await import(subpath)
      }

      try {
        await import('@lupinum/ginko-content/cms-import')
        throw new Error('Superseded CMS import subpath unexpectedly resolved')
      } catch (error) {
        if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
      }

      const { mkdtemp, readFile, rm } = await import('node:fs/promises')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const { collectPortableMdcAssetReferences, parsePortableDocument, rewritePortableMdcAssetReferences } = await import('@lupinum/ginko-content/portability')
      const { readPortableDirectory, rebuildPortableDirectoryManifest, writePortableDirectory } = await import('@lupinum/ginko-content/portability/node')
      const { PORTABILITY_CONTRACT_FIXTURES, createPortabilityContractFixture, runPortabilityContract, runPortableDirectoryContract } = await import('@lupinum/ginko-content/testing/portability-contract')
      const parent = await mkdtemp(join(tmpdir(), 'ginko-packed-portability-'))
      try {
        const contract = createPortabilityContractFixture()
        const document = await parsePortableDocument(PORTABILITY_CONTRACT_FIXTURES.document, contract)
        const result = await runPortabilityContract()
        if (result.checks !== 9) throw new Error('Packed portability codec contract failed')
        const localPath = '/ginko-assets/' + PORTABILITY_CONTRACT_FIXTURES.png.sha256 + '.png'
        const codeDelimiter = String.fromCharCode(96)
        const body = '![Packed](' + localPath + ')\\n\\n' + codeDelimiter + localPath + codeDelimiter
        const references = await collectPortableMdcAssetReferences(body, contract.collections.docs.componentPolicy)
        const rewritten = await rewritePortableMdcAssetReferences(
          body,
          contract.collections.docs.componentPolicy,
          reference => 'https://assets.example.test/' + reference.sha256 + '.png'
        )
        if (references.length !== 1 || !rewritten.includes('https://assets.example.test/') || !rewritten.includes(codeDelimiter + localPath + codeDelimiter)) {
          throw new Error('Packed portability MDC asset contract failed')
        }
        const directory = await runPortableDirectoryContract({
          firstDestination: join(parent, 'first'),
          secondDestination: join(parent, 'second'),
          write: writePortableDirectory,
          read: readPortableDirectory,
          rebuildManifest: rebuildPortableDirectoryManifest,
          readManifestBytes: destination => readFile(join(destination, '.ginko/portable.json'))
        })
        if (directory.checks !== 3 || document.canonicalKey !== 'docs.introduction') throw new Error('Packed portability directory contract failed')
      } finally {
        await rm(parent, { recursive: true, force: true })
      }
    `)

    if (packageManager === 'pnpm') {
      run('pnpm', ['install', '--frozen-lockfile=false', '--config.dangerously-allow-all-builds=true'], appDir)
    } else {
      run('npm', ['install', '--no-audit', '--no-fund'], appDir)
    }
    assertDeclarations(appDir)
    run('node', ['scripts/import-public-subpaths.mjs'], appDir)
    packageExec('nuxi', ['prepare'], appDir)
    packageExec('nuxi', ['typecheck'], appDir)
    packageExecAndRejectOutput('nuxt', ['build'], appDir, [
      /could not be resolved[\s\S]*treating it as an external dependency/i
    ])

    const cliHelp = packageExecAndCapture('ginko-content', ['--help'], appDir)
    if (!cliHelp.includes('validate [root]')) {
      throw new Error(`Packed CLI help does not expose content validation:\n${cliHelp}`)
    }

    const filesystemDir = resolve(tempRoot, 'filesystem-check')
    mkdirSync(resolve(filesystemDir, 'content'), { recursive: true })
    symlinkSync(resolve(appDir, 'node_modules'), resolve(filesystemDir, 'node_modules'), 'junction')
    writeFile(resolve(filesystemDir, 'package.json'), JSON.stringify({ type: 'module', private: true }, null, 2))
    writeFile(resolve(filesystemDir, 'nuxt.config.ts'), `
      export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content'],
        content: {
          agent: false,
          search: { engine: 'pagefind' },
          sitemap: false,
          validation: 'report'
        },
        compatibilityDate: '2026-04-14'
      })
    `)
    writeFile(resolve(filesystemDir, 'content.config.ts'), `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
      export const pages = defineCollection({ type: 'page', source: '*.md' })
      export default defineContentConfig({ collections: { pages } })
    `)
    writeFile(resolve(filesystemDir, 'content/index.md'), `
---
title: Pagefind Package Check
---

# Pagefind Package Check
    `)
    packageExecAndRejectOutput('nuxt', ['build'], filesystemDir, [
      /could not be resolved[\s\S]*treating it as an external dependency/i
    ])

    const pagefindDir = resolve(filesystemDir, '.output/public/pagefind')
    const pagefindManifestPath = resolve(pagefindDir, 'ginko-locales.json')
    if (!existsSync(resolve(pagefindDir, 'pagefind.js')) || !existsSync(pagefindManifestPath)) {
      throw new Error('Packed consumer build did not emit Pagefind entry and locale manifest artifacts')
    }
    const pagefindManifest = JSON.parse(readFileSync(pagefindManifestPath, 'utf8'))
    if (pagefindManifest.version !== 1 || pagefindManifest.defaultLocale !== 'en' || pagefindManifest.indexes?.en !== 'pagefind.js') {
      throw new Error(`Packed consumer build emitted an invalid Pagefind locale manifest:\n${JSON.stringify(pagefindManifest)}`)
    }

    const port = 4599
    const baseURL = `http://127.0.0.1:${port}`
    server = spawn('node', ['.output/server/index.mjs'], {
      cwd: appDir,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        NODE_ENV: 'production'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    await waitForServer(server, baseURL)

    const pageResponse = await fetch(baseURL)
    const html = await pageResponse.text()
    if (!pageResponse.ok || !html.includes('Package Consumer Page')) {
      throw new Error(`Packed consumer page failed: ${pageResponse.status}\n${html.slice(0, 500)}`)
    }
    const cachePageResponse = await fetch(`${baseURL}/cache-live`)
    const cachePageBody = await cachePageResponse.text()
    if (
      !cachePageResponse.ok ||
      !cachePageBody.includes('Package Consumer Page') ||
      !cachePageResponse.headers.get('cache-control')?.includes('max-age=60')
    ) {
      throw new Error(`Live SSR page omitted provider cache metadata: ${cachePageResponse.status} ${cachePageResponse.headers.get('cache-control')}`)
    }

    const encodeQuery = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const queryUrl = params => `${baseURL}/api/_content/query/packed/${encodeQuery(params)}.json`
    const readJsonResponse = async (response, label) => {
      const body = await response.text()
      if (!response.ok) throw new Error(`${label} failed: ${response.status}\n${body.slice(0, 500)}`)
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`${label} did not return JSON: ${response.headers.get('content-type')}`)
      }
      if (!body) throw new Error(`${label} returned an unexpected empty body`)
      return JSON.parse(body)
    }

    const foundResponse = await fetch(queryUrl({ collection: 'pages', where: [{ path: '/' }], first: true }))
    const foundBody = await readJsonResponse(foundResponse, 'found first query')
    if (foundBody.result?.title !== 'Package Consumer Page') {
      throw new Error(`Found first query returned an invalid envelope: ${JSON.stringify(foundBody)}`)
    }
    const missingResponse = await fetch(queryUrl({ collection: 'pages', where: [{ path: '/missing' }], first: true }))
    const missingBody = await readJsonResponse(missingResponse, 'missing first query')
    if (missingResponse.status !== 200 || Object.keys(missingBody).join() !== 'result' || missingBody.result !== null) {
      throw new Error(`Missing first query did not return { result: null }: ${JSON.stringify(missingBody)}`)
    }

    const listBody = await readJsonResponse(
      await fetch(queryUrl({ collection: 'pages', limit: 2 })),
      'list query'
    )
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
    if (ofetchBody.result !== null) {
      throw new Error(`$fetch did not preserve the missing result envelope: ${JSON.stringify(ofetchBody)}`)
    }

    const missingPageResponse = await fetch(`${baseURL}/missing`)
    const missingPageHtml = await missingPageResponse.text()
    if (!missingPageResponse.ok || !missingPageHtml.includes('Missing document')) {
      throw new Error(`Client-facing missing query failed: ${missingPageResponse.status}\n${missingPageHtml.slice(0, 500)}`)
    }

    const providerFailureResponse = await fetch(queryUrl({
      collection: 'pages',
      where: [{ path: '/provider-failure' }],
      first: true
    }))
    const providerFailureText = await providerFailureResponse.text()
    if (
      providerFailureResponse.status !== 502 ||
      !providerFailureText.includes('BACKEND_FAILURE') ||
      providerFailureText.includes('memory')
    ) {
      throw new Error(`Provider failure was not sanitized: ${providerFailureResponse.status}\n${providerFailureText.slice(0, 500)}`)
    }

    const navigationResponse = await fetch(`${baseURL}/api/_content/navigation?collection=pages`)
    const navigationBody = await navigationResponse.text()
    if (!navigationResponse.ok || !navigationBody.includes('"path":"/"')) {
      throw new Error(`Packed consumer content API failed: ${navigationResponse.status}\n${navigationBody.slice(0, 500)}`)
    }

    const searchBody = await readJsonResponse(
      await fetch(`${baseURL}/api/_content/search?q=Package`),
      'search query'
    )
    if (!Array.isArray(searchBody)) {
      throw new TypeError(`Packed consumer search returned an invalid response: ${JSON.stringify(searchBody)}`)
    }

    const siteDataBody = await readJsonResponse(
      await fetch(`${baseURL}/api/_content/site-data?key=settings`),
      'site-data query'
    )
    if (siteDataBody.data?.fixture !== 'packed-memory') {
      throw new Error(`Packed consumer site data did not use the in-memory provider: ${JSON.stringify(siteDataBody)}`)
    }

    const sitemapApiBody = await readJsonResponse(
      await fetch(`${baseURL}/api/_content/sitemap`),
      'sitemap route enumeration'
    )
    if (!Array.isArray(sitemapApiBody) || sitemapApiBody.length !== 2) {
      throw new Error(`Packed consumer route enumeration lost routes: ${JSON.stringify(sitemapApiBody)}`)
    }

    const importSmokeResponse = await fetch(`${baseURL}/api/import-smoke`)
    const importSmokeBody = await importSmokeResponse.text()
    // Assert that the trimmed /agent subpath is usable from a real Nitro
    // handler, not merely importable in an isolated Node process.
    if (!importSmokeResponse.ok || !importSmokeBody.includes('"agentRegistry":"function"')) {
      throw new Error(`Packed consumer Nuxt import smoke failed: ${importSmokeResponse.status}\n${importSmokeBody.slice(0, 500)}`)
    }

    const sitemapPath = resolve(appDir, '.output/public/sitemap.xml')
    if (!existsSync(sitemapPath)) {
      throw new Error('Packed consumer build did not emit .output/public/sitemap.xml')
    }
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
    if (server && server.exitCode === null) {
      await stopServer(server)
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
