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
}

export interface ProductionFixtureServer extends ProductionFixtureBuild {
  baseURL: string
  stop: () => Promise<void>
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let buildPackagesPromise: Promise<void> | undefined
const buildPromises = new Map<string, Promise<ProductionFixtureBuild>>()
const currentBuildKeyByFixture = new Map<string, string>()

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

function fixtureBuildKey (rootDir: string, env: Record<string, string>) {
  return `${resolve(rootDir)}::${JSON.stringify(normalizeFixtureEnv(env))}`
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

export async function buildProductionFixture (
  rootDir: string,
  env: Record<string, string> = {}
): Promise<ProductionFixtureBuild> {
  const resolvedRoot = resolve(rootDir)
  const normalizedEnv = normalizeFixtureEnv(env)
  const key = fixtureBuildKey(resolvedRoot, normalizedEnv)
  const currentKey = currentBuildKeyByFixture.get(resolvedRoot)

  if (currentKey === key && buildPromises.has(key)) {
    return await buildPromises.get(key)!
  }

  const buildPromise = Promise.resolve().then(async () => {
    await ensureWorkspacePackagesBuilt()

    try {
      execSync('pnpm exec nuxi build', {
        cwd: resolvedRoot,
        env: {
          ...globalThis.process.env,
          NODE_ENV: 'production',
          ...normalizedEnv
        },
        stdio: 'pipe'
      })
    } catch (error) {
      const commandError = error as Error & { stdout?: Buffer | string, stderr?: Buffer | string }
      const stdout = commandError.stdout?.toString() || ''
      const stderr = commandError.stderr?.toString() || ''
      throw new Error(`Failed to build production fixture ${resolvedRoot}\n${stdout}${stderr}`)
    }

    currentBuildKeyByFixture.set(resolvedRoot, key)

    return {
      rootDir: resolvedRoot,
      publicDir: resolve(resolvedRoot, '.output/public'),
      serverDir: resolve(resolvedRoot, '.output/server'),
      env: normalizedEnv
    }
  })

  buildPromises.set(key, buildPromise)
  return await buildPromise
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
