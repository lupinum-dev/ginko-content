import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
const buildOnly = cliArgs.includes('--build-only')

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
  '@lupinum/ginko-content/provider',
  '@lupinum/ginko-content/transformers',
  '@lupinum/ginko-content/cms-contract',
  '@lupinum/ginko-content/cms-import',
  '@lupinum/ginko-content/testing/provider-fixture',
  '@lupinum/ginko-content/testing/provider-contract'
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
  'dist/runtime/app/composables/toc.d.ts',
  'dist/public/agent.d.ts',
  'dist/runtime/transformers/define.d.ts',
  'dist/cms-contract/index.d.ts',
  'dist/cms-import/index.d.ts',
  'dist/testing/provider-fixture.d.ts',
  'dist/testing/provider-contract.d.ts',
  'dist/types/query.d.ts'
]

function run(command, args, cwd, options = {}) {
  try {
    execFileSync(command, args, {
      cwd,
      env: {
        ...process.env,
        npm_config_verify_deps_before_run: 'false',
        ...options.env
      },
      stdio: options.stdio || 'inherit'
    })
  } catch (error) {
    const commandText = [command, ...args].join(' ')
    throw new Error(`Command failed in ${cwd}: ${commandText}`, { cause: error })
  }
}

function runAndRejectOutput(command, args, cwd, forbiddenPatterns) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      npm_config_verify_deps_before_run: 'false'
    },
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`

  if (result.status !== 0) {
    throw new Error(`Command failed in ${cwd}: ${[command, ...args].join(' ')}\n${output}`)
  }

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
    console.log(`Testing exact release tarball with ${packageManager}: ${tarball} (sha256 ${tarballSha256})`)
    assertNoWorkspaceRanges(tarball, tempRoot)

    writeFile(resolve(appDir, 'package.json'), JSON.stringify({
      type: 'module',
      private: true,
      scripts: {
        typecheck: 'nuxi typecheck',
        build: 'nuxt build'
      },
      dependencies: {
        '@lupinum/ginko-content': `file:${tarball}`,
        '@nuxtjs/sitemap': process.env.GINKO_CONSUMER_SITEMAP_VERSION || '8.0.15',
        '@types/node': process.env.GINKO_CONSUMER_NODE_TYPES_VERSION || '^24.0.0',
        nuxt: process.env.GINKO_CONSUMER_NUXT_VERSION || '4.4.7',
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
    mkdirSync(resolve(appDir, 'scripts'), { recursive: true })

    writeFile(resolve(appDir, 'nuxt.config.ts'), `
      export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content', '@nuxtjs/sitemap'],
        site: {
          url: 'https://packed-consumer.example.test',
          name: 'Packed Consumer'
        },
        content: {
          agent: {
            linkHeaders: true,
            markdownNegotiation: true
          },
          sitemap: true
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

::packed-sentinel
::
    `)

    writeFile(
      resolve(appDir, 'server/plugins/register-serializer.ts'),
      `
      import {
        agentRawPathForRoute,
        registerAgentMarkdownSerializer
      } from '@lupinum/ginko-content/agent'

      if (agentRawPathForRoute('/docs/intro') !== '/raw/docs/intro.md') {
        throw new Error('Packed agent path helper export is invalid')
      }

      export default defineNitroPlugin(() => {
        registerAgentMarkdownSerializer('packed-sentinel', () => 'PACKED_SERIALIZER_SENTINEL')
      })
    `)

    writeFile(resolve(appDir, 'pages/index.vue'), `
      <script setup lang="ts">
      import { useContentPage } from '#imports'
      import { pages } from '../content.config'

      const { page } = await useContentPage(pages)
      </script>

      <template>
        <ContentRenderer v-if="page" :value="page" />
      </template>
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

    if (buildOnly) {
      console.log(`Packed consumer ${packageManager} prepare/typecheck/build passed.`)
      return
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

    const navigationResponse = await fetch(`${baseURL}/api/_content/navigation?collection=pages`)
    const navigationBody = await navigationResponse.text()
    if (!navigationResponse.ok || !navigationBody.includes('"path":"/"')) {
      throw new Error(`Packed consumer content API failed: ${navigationResponse.status}\n${navigationBody.slice(0, 500)}`)
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
    if (!llms.includes('/raw/index.md') || !rawMarkdown.includes('# Package Consumer Page') || !rawMarkdown.includes('PACKED_SERIALIZER_SENTINEL')) {
      throw new Error(`Packed consumer agent markdown output is invalid:\n${llms.slice(0, 300)}\n${rawMarkdown.slice(0, 300)}`)
    }

    console.log(`Packed consumer ${packageManager} test passed.`)
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
