import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(repoRoot, 'packages/content')

const nodeImportableSubpaths = [
  '@lupinum/ginko-content/config',
  '@lupinum/ginko-content/toc',
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
  'dist/runtime/app/composables/toc.d.ts',
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

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'ginko-packed-consumer-'))
  let server

  try {
    const packDir = resolve(tempRoot, 'pack')
    const appDir = resolve(tempRoot, 'app')
    mkdirSync(packDir, { recursive: true })
    mkdirSync(appDir, { recursive: true })

    run('pnpm', ['run', 'build:packages'], repoRoot)
    run('pnpm', ['pack', '--pack-destination', packDir], packageRoot)

    const tarballs = readdirSync(packDir).filter(file => file.endsWith('.tgz'))
    if (tarballs.length !== 1) {
      throw new Error(`Expected exactly one packed tarball, found ${tarballs.length}`)
    }

    const tarball = resolve(packDir, tarballs[0])
    assertNoWorkspaceRanges(tarball, tempRoot)

    writeFile(resolve(appDir, 'package.json'), JSON.stringify({
      type: 'module',
      private: true,
      scripts: {
        prepare: 'nuxi prepare',
        typecheck: 'nuxi typecheck',
        build: 'nuxt build'
      },
      dependencies: {
        '@lupinum/ginko-content': `file:${tarball}`,
        '@types/node': '25.8.0',
        nuxt: '4.4.7',
        typescript: '6.0.3',
        vue: '3.5.35',
        'vue-tsc': '3.2.9',
        vitest: '4.1.6'
      }
    }, null, 2))

    mkdirSync(resolve(appDir, 'content'), { recursive: true })
    mkdirSync(resolve(appDir, 'pages'), { recursive: true })
    mkdirSync(resolve(appDir, 'server/api'), { recursive: true })
    mkdirSync(resolve(appDir, 'scripts'), { recursive: true })

    writeFile(resolve(appDir, 'nuxt.config.ts'), `
      export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content'],
        compatibilityDate: '2026-04-14'
      })
    `)

    writeFile(resolve(appDir, 'tsconfig.json'), JSON.stringify({
      extends: './.nuxt/tsconfig.json'
    }, null, 2))

    writeFile(resolve(appDir, 'content.config.ts'), `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const pages = defineCollection({
        type: 'page',
        source: '*.md'
      })

      export default defineContentConfig({
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

    writeFile(resolve(appDir, 'pages/index.vue'), `
      <script setup lang="ts">
      import { useContentPage } from '#imports'
      import { pages } from '../content.config'

      const { page } = await useContentPage(pages, { notFound: false })
      </script>

      <template>
        <ContentRenderer v-if="page" :value="page" />
      </template>
    `)

    writeFile(resolve(appDir, 'pages/import-smoke.vue'), `
      <script setup lang="ts">
      import { one, useContentPage, useContentSearchResults } from '@lupinum/ginko-content/client'
      import { extractContentToc, useContentToc } from '@lupinum/ginko-content/toc'

      void [one, useContentPage, useContentSearchResults, extractContentToc, useContentToc]
      </script>

      <template>
        <main>
          <h1>Import Smoke</h1>
        </main>
      </template>
    `)

    writeFile(resolve(appDir, 'server/api/import-smoke.get.ts'), `
      import { one, many } from '@lupinum/ginko-content/server'
      import { extractContentToc } from '@lupinum/ginko-content/toc'

      export default defineEventHandler(() => ({
        server: typeof one,
        many: typeof many,
        toc: extractContentToc('## Import Smoke').links[0]?.text
      }))
    `)

    writeFile(resolve(appDir, 'scripts/import-public-subpaths.mjs'), `
      const subpaths = ${JSON.stringify(nodeImportableSubpaths, null, 2)}

      for (const subpath of subpaths) {
        console.log(\`Importing \${subpath}\`)
        await import(subpath)
      }
    `)

    run('pnpm', ['install', '--frozen-lockfile=false'], appDir)
    assertDeclarations(appDir)
    run('pnpm', ['exec', 'node', 'scripts/import-public-subpaths.mjs'], appDir)
    run('pnpm', ['exec', 'nuxi', 'prepare'], appDir)
    run('pnpm', ['exec', 'nuxi', 'typecheck'], appDir)
    runAndRejectOutput('pnpm', ['exec', 'nuxt', 'build'], appDir, [
      /could not be resolved[\s\S]*treating it as an external dependency/i
    ])

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
    if (!importSmokeResponse.ok || !importSmokeBody.includes('Import Smoke')) {
      throw new Error(`Packed consumer Nuxt import smoke failed: ${importSmokeResponse.status}\n${importSmokeBody.slice(0, 500)}`)
    }

    console.log('Packed consumer test passed.')
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 250))
      if (server.exitCode === null) {
        server.kill('SIGKILL')
      }
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
