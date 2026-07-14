import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

describe('Content 0.4 candidate release contract', () => {
  it('commits the coordinated RC version and deterministic candidate command', async () => {
    const workspace = await readJson<{ scripts?: Record<string, string> }>('package.json')
    const manifest = await readJson<{ name: string; version: string }>(
      'packages/content/package.json',
    )
    const compatibility = await readJson<{
      releaseStack: Record<string, string>
    }>('packages/content/compatibility.json')

    expect(manifest).toMatchObject({
      name: '@lupinum/ginko-content',
      version: '0.4.0-rc.1',
    })
    expect(workspace.scripts?.['candidate:pack']).toBe('node scripts/candidate-pack.mjs')
    expect(compatibility.releaseStack).toMatchObject({
      '@lupinum/ginko-content': '0.4.0-rc.1',
      '@lupinum/ginko-cms': '0.2.0-rc.1',
      '@lupinum/ginko-cms-convex': '0.2.0-rc.1',
      '@lupinum/ginko-cms-contract': '0.2.0-rc.1',
    })
  })
})
