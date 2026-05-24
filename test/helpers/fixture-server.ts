import { execSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export interface FixtureServer {
  baseURL: string
  stop: () => Promise<void>
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let buildPackagesPromise: Promise<void> | undefined

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

async function allocatePort () {
  const server = createServer()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })

  if (!port) {
    throw new Error('Failed to allocate fixture server port')
  }

  return port
}

export async function startFixtureServer (
  rootDir: string,
  port?: number,
  env: Record<string, string> = {}
): Promise<FixtureServer> {
  const resolvedPort = port || await allocatePort()
  const host = '127.0.0.1'
  const baseURL = `http://${host}:${resolvedPort}`
  let output = ''

  await ensureWorkspacePackagesBuilt()

  try {
    execSync('pnpm exec nuxi build', {
      cwd: rootDir,
      env: {
        ...globalThis.process.env,
        NODE_ENV: 'production',
        ...env
      },
      stdio: 'pipe'
    })
  } catch (error) {
    const commandError = error as Error & { stdout?: Buffer | string, stderr?: Buffer | string }
    const stdout = commandError.stdout?.toString() || ''
    const stderr = commandError.stderr?.toString() || ''
    throw new Error(`Failed to build fixture ${rootDir}\n${stdout}${stderr}`)
  }

  const child = spawn('node', ['.output/server/index.mjs'], {
    cwd: rootDir,
    env: {
      ...globalThis.process.env,
      PORT: String(resolvedPort),
      HOST: host,
      NODE_ENV: 'production',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout?.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString()
  })

  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Fixture server exited early for ${rootDir}\n${output}`)
    }

    if (output.includes(`Listening on http://${host}:${resolvedPort}`)) {
      await delay(500)
      return {
        baseURL,
        stop: async () => {
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
      }
    }

    try {
      const response = await fetch(`${baseURL}/`, { redirect: 'manual' })
      if (response.ok || response.status === 404) {
        const html = await response.text()
        if (!html.includes('__NUXT_LOADING__')) {
          return {
            baseURL,
            stop: async () => {
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
          }
        }
      }
    } catch {
      // Wait for server boot.
    }

    await delay(100)
  }

  child.kill('SIGKILL')
  throw new Error(`Timed out waiting for fixture server ${rootDir}\n${output}`)
}
