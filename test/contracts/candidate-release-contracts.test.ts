import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

const releaseVersion = '0.3.0-rc.2'

describe('Content 0.3 candidate release contract', () => {
  it('commits one coordinated RC identity', async () => {
    const workspace = await readJson<{ scripts?: Record<string, string> }>('package.json')
    const manifest = await readJson<{ name: string; version: string }>(
      'packages/content/package.json',
    )
    const compatibility = await readJson<{
      releaseStack: Record<string, string>
    }>('packages/content/compatibility.json')

    expect(manifest).toMatchObject({
      name: '@lupinum/ginko-content',
      version: releaseVersion,
    })
    expect(workspace.scripts?.['release:pack']).toBe('node scripts/release-pack.mjs')
    expect(workspace.scripts?.['audit:prod']).toBe('node scripts/audit-production.mjs')
    expect(workspace.scripts).not.toHaveProperty('candidate:pack')
    expect(compatibility.releaseStack).toMatchObject({
      '@lupinum/ginko-content': releaseVersion,
      '@lupinum/ginko-cms': '0.2.0-rc.1',
      '@lupinum/ginko-cms-convex': '0.2.0-rc.1',
      '@lupinum/ginko-cms-contract': '0.2.0-rc.1',
    })
  })

  it('keeps one manifest-derived pack path', async () => {
    const releasePack = await readFile('scripts/release-pack.mjs', 'utf8')
    const productionAudit = await readFile('scripts/audit-production.mjs', 'utf8')
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
    const developmentPack = await readFile('scripts/dev-pack.mjs', 'utf8')

    expect(developmentPack).toContain("readFileSync(resolve(packageRoot, 'package.json'), 'utf8')")
    expect(developmentPack).not.toMatch(/INTENDED_VERSION\s*=\s*['"]\d+\.\d+\.\d+/)
    expect(releasePack).toContain('assertReproduciblePacks(first, second)')
    expect(productionAudit).toContain("'--package-lock-only'")
    expect(productionAudit).toContain("'--omit=dev'")
    expect(productionAudit).not.toContain('--ignore-registry-errors')
    expect(workflow).toContain('m.reproduciblePacks !== 2')
    await expect(readFile('scripts/candidate-pack.mjs', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ships curated release notes and one combined 0.3 specification', async () => {
    const changelog = await readFile('CHANGELOG.md', 'utf8')
    const specification = await readFile('VNEXT-0.3-PORTABILITY.md', 'utf8')
    const migration = await readFile(
      'docs/content/docs/6.migration/4.ginko-version-upgrades.md',
      'utf8',
    )

    expect(changelog).toContain(`## v${releaseVersion}`)
    expect(changelog).toContain('### Migrating from 0.2.1')
    expect(specification).toContain('# Ginko Content 0.3 Data Source And Portability Addendum')
    expect(specification).toContain(`Target: \`${releaseVersion}\`, followed by \`0.3.0\``)
    expect(specification).not.toMatch(/accepted, clean Ginko Content `0\.3\.0`/)
    expect(migration).toContain('Ginko Content `0.3` combines')
    expect(migration).toContain('`@lupinum/ginko-content/cms-import` is removed')
    expect(migration).toContain('pnpm add @lupinum/ginko-content@next')
  })

  it('publishes prereleases without changing the stable npm or GitHub channels', async () => {
    const runbook = await readFile('MAINTAINING.md', 'utf8')

    expect(runbook).toContain('NPM_TAG=next')
    expect(runbook).toContain('GH_RELEASE_FLAG=--prerelease')
    expect(runbook).toMatch(/npm publish \.pack\/lupinum-ginko-content-\$VERSION\.tgz[\s\S]*--tag "\$NPM_TAG"/)
    expect(runbook).toMatch(/gh release create v\$VERSION[\s\S]*\$GH_RELEASE_FLAG/)
  })

  it('runs portability and an exact packed consumer on Windows', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
    const releasePack = await readFile('scripts/release-pack.mjs', 'utf8')
    const packedConsumer = await readFile('scripts/test-packed-consumer.mjs', 'utf8')
    const packedConsumerRun = packedConsumer.slice(
      packedConsumer.indexOf('function run('),
      packedConsumer.indexOf('function runAndCapture('),
    )
    const packedConsumerMain = packedConsumer.slice(
      packedConsumer.indexOf('async function main()'),
    )

    expect(workflow).toContain('windows-portability:')
    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).toContain('test/contracts/portability-directory-contracts.test.ts')
    expect(workflow).toContain('pnpm release:pack')
    expect(workflow).toContain('scripts/test-packed-consumer.mjs --package-manager pnpm --build-only --tarball-dir .pack')
    expect(releasePack).toContain("shell: process.platform === 'win32'")
    expect(releasePack.match(/execFileSync\(/g)).toHaveLength(1)
    expect(packedConsumerRun).toContain("shell: process.platform === 'win32'")
    expect(packedConsumer.match(/execFileSync\(/g)).toHaveLength(1)
    expect(packedConsumerMain).toContain("mkdtempSync(join(tmpdir(), 'ginko-packed-consumer-'))")
    expect(packedConsumerMain).toContain("join(tempRoot, 'artifacts', `${tarballSha256}.tgz`)")
    expect(packedConsumerMain).not.toContain('RUNNER_TEMP')
  })
})
