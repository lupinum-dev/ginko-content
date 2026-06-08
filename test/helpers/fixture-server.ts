import { startProductionFixtureServer } from './production-fixture'

export interface FixtureServer {
  baseURL: string
  stop: () => Promise<void>
}

export async function startFixtureServer (
  rootDir: string,
  port?: number,
  env: Record<string, string> = {}
): Promise<FixtureServer> {
  return await startProductionFixtureServer(rootDir, port, env)
}
