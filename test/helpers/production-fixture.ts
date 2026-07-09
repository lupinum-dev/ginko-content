import { execSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export interface ProductionFixtureBuild {
  rootDir: string
  publicDir: string
  serverDir: string
  env: Record<string, string>
  /** Raw stdout captured from the build command (used to corroborate build-time hook execution, e.g. C-6). */
  stdout?: string
}

export interface ProductionFixtureServer extends ProductionFixtureBuild {
  baseURL: string
  stop: () => Promise<void>
}

export interface GenerateStaticFixture {
  rootDir: string
  publicDir: string
  env: Record<string, string>
  /** Raw stdout captured from `nuxi generate` (used to corroborate build-time hook execution, e.g. C-6). */
  stdout: string
}

export type FixtureBuildMode = 'build' | 'generate'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let buildPackagesPromise: Promise<void> | undefined
const buildPromises = new Map<string, Promise<ProductionFixtureBuild>>()
const currentBuildKeyByFixture = new Map<string, string>()
const activeBuildKeyByFixture = new Map<string, string>()

async function ensureWorkspacePackagesBuilt () {
  if (!buildPackagesPromise) {
    buildPackagesPromise = Promise.resolve().then(() => {
      execSync('pnpm build:packages', {
        cwd: workspaceRoot,
        env: {
          ...globalThis.process.env,
          NODE_ENV: 'production'
        },
        stdio: 'pipe'
      })
    })
  }

  await buildPackagesPromise
}

function normalizeFixtureEnv (env: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([, value]) => typeof value === 'string')
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

// std-env's `isTest` (used by consola/nitro to switch to a minimal, low-verbosity reporter)
// treats `process.env.TEST`/`VITEST` as truthy. Vitest sets both on its own worker process; if we
// blindly forward that env to the spawned `nuxi build`/`nuxi generate` child, the child believes
// *it* is running under a test runner and silences info-level logger output (e.g. the sitemap
// assertion pass/fail line consumed by the T1-3 corroboration check) even though the build itself
// completes normally. Strip the markers so the child logs the way a real CI/production build would.
const testEnvMarkersToStrip = ['TEST', 'VITEST', 'VITEST_WORKER_ID', 'VITEST_POOL_ID']

function buildFixtureChildEnv (extra: Record<string, string>) {
  const childEnv = Object.fromEntries(
    Object.entries(globalThis.process.env).filter(([key]) => !testEnvMarkersToStrip.includes(key))
  )
  return {
    ...childEnv,
    NODE_ENV: 'production',
    ...extra
  }
}

export function fixtureBuildKey (
  rootDir: string,
  env: Record<string, string>,
  mode: FixtureBuildMode = 'build'
) {
  // C-1: the `::generate` component is load-bearing — without it, a `generate` result would be
  // served for a `build` request (or vice versa) whenever rootDir+env match, silently mixing a
  // fully static output with a node-server output.
  const modeComponent = mode === 'generate' ? '::generate' : ''
  return `${resolve(rootDir)}${modeComponent}::${JSON.stringify(normalizeFixtureEnv(env))}`
}

async function allocatePort () {
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })

  if (!port) {
    throw new Error('Failed to allocate fixture server port')
  }

  return port
}

async function runFixtureBuildCommand (
  rootDir: string,
  env: Record<string, string>,
  mode: FixtureBuildMode
): Promise<ProductionFixtureBuild> {
  const resolvedRoot = resolve(rootDir)
  const normalizedEnv = normalizeFixtureEnv(env)
  const key = fixtureBuildKey(resolvedRoot, normalizedEnv, mode)
  const currentKey = currentBuildKeyByFixture.get(resolvedRoot)
  const activeKey = activeBuildKeyByFixture.get(resolvedRoot)

  if (currentKey === key && buildPromises.has(key)) {
    return await buildPromises.get(key)!
  }
  if (activeKey) {
    if (activeKey === key && buildPromises.has(key)) {
      return await buildPromises.get(key)!
    }
    throw new Error(
      `Refusing concurrent production fixture builds for ${resolvedRoot}: ${activeKey} is still active while ${key} was requested. ` +
      'Each variant writes the same .output directory and must run serially.'
    )
  }

  const command = mode === 'generate' ? 'pnpm exec nuxi generate' : 'pnpm exec nuxi build'

  const buildPromise = Promise.resolve().then(async () => {
    try {
      await ensureWorkspacePackagesBuilt()

      let stdout = ''
      try {
        stdout = execSync(command, {
          cwd: resolvedRoot,
          env: buildFixtureChildEnv(normalizedEnv),
          stdio: 'pipe'
        }).toString()
      } catch (error) {
        const commandError = error as Error & { stdout?: Buffer | string, stderr?: Buffer | string }
        const errStdout = commandError.stdout?.toString() || ''
        const stderr = commandError.stderr?.toString() || ''
        throw new Error(`Failed to run "${command}" for fixture ${resolvedRoot}\n${errStdout}${stderr}`)
      }

      currentBuildKeyByFixture.set(resolvedRoot, key)

      return {
        rootDir: resolvedRoot,
        publicDir: resolve(resolvedRoot, '.output/public'),
        serverDir: resolve(resolvedRoot, '.output/server'),
        env: normalizedEnv,
        stdout
      }
    } finally {
      if (activeBuildKeyByFixture.get(resolvedRoot) === key) {
        activeBuildKeyByFixture.delete(resolvedRoot)
      }
    }
  })

  buildPromises.set(key, buildPromise)
  activeBuildKeyByFixture.set(resolvedRoot, key)
  return await buildPromise
}

export async function buildProductionFixture (
  rootDir: string,
  env: Record<string, string> = {}
): Promise<ProductionFixtureBuild> {
  return await runFixtureBuildCommand(rootDir, env, 'build')
}

/**
 * Runs `nuxi generate` (full static output) for a fixture instead of `nuxi build`.
 * Reuses the same env-keyed cache map as `buildProductionFixture` (C-1), but the key carries a
 * distinct `::generate` component so a `generate` result is never served for a `build` request,
 * or vice versa, even when rootDir+env are otherwise identical.
 */
export async function generateStaticFixture (
  rootDir: string,
  env: Record<string, string> = {}
): Promise<GenerateStaticFixture> {
  const build = await runFixtureBuildCommand(rootDir, env, 'generate')
  return {
    rootDir: build.rootDir,
    publicDir: build.publicDir,
    env: build.env,
    stdout: build.stdout || ''
  }
}

export async function startProductionFixtureServer (
  rootDir: string,
  port?: number,
  env: Record<string, string> = {}
): Promise<ProductionFixtureServer> {
  const build = await buildProductionFixture(rootDir, env)
  const resolvedPort = port || await allocatePort()
  const host = '127.0.0.1'
  const baseURL = `http://${host}:${resolvedPort}`
  let output = ''

  const child = spawn('node', ['.output/server/index.mjs'], {
    cwd: build.rootDir,
    env: {
      ...globalThis.process.env,
      PORT: String(resolvedPort),
      HOST: host,
      NODE_ENV: 'production',
      ...build.env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout?.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString()
  })

  const stop = async () => {
    if (child.exitCode !== null) {
      return
    }

    child.kill('SIGTERM')

    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) {
        return
      }
      await delay(100)
    }

    child.kill('SIGKILL')
  }

  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Production fixture server exited early for ${build.rootDir}\n${output}`)
    }

    try {
      const response = await fetch(`${baseURL}/`, { redirect: 'manual' })
      if (response.ok || response.status === 404) {
        const html = await response.text()
        if (!html.includes('__NUXT_LOADING__')) {
          return { ...build, baseURL, stop }
        }
      }
    } catch {
      // Wait for server boot.
    }

    await delay(100)
  }

  await stop()
  throw new Error(`Timed out waiting for production fixture server ${build.rootDir}\n${output}`)
}
