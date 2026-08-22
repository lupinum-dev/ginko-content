import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  readResolvedContentContract,
  writeResolvedContentContractArtifact,
} from '../../packages/content/src/cms-contract-node/artifact'
import { buildResolvedContentContract, hashCanonicalJson, type JsonValue } from '../../packages/content/src/cms-contract'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'ginko-contract-artifact-'))
  roots.push(value)
  return value
}

const contract = () => buildResolvedContentContract({
  collections: {
    docs: {
      type: 'page',
      i18n: true,
      route: { en: '/docs', de: '/dokumentation' },
    },
  },
}, {
  defaultLocale: 'en',
  locales: ['en', 'de'],
  localeFallbacks: { de: ['en'] },
  translatedSlugs: true,
  componentPolicy: {
    components: {
      callout: {
        kind: 'block',
        props: { tone: { type: 'string', required: false } },
        slots: ['default'],
        media: null,
      },
    },
  },
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('resolved Content contract artifact', () => {
  it('writes canonical bytes atomically and reads the validated contract with its hash', async () => {
    const project = await root()
    const expected = contract()

    const written = await writeResolvedContentContractArtifact(project, expected)
    const read = await readResolvedContentContract({ root: project })

    expect(read).toEqual(written)
    expect(read.contract).toEqual(expected)
    expect(read.sha256).toBe(await hashCanonicalJson(expected as unknown as JsonValue))
    const bytes = await readFile(join(project, '.ginko/content-contract.json'), 'utf8')
    expect(bytes.endsWith('\n')).toBe(true)
    expect(JSON.parse(bytes)).toEqual(expected)
  })

  it('replaces an existing artifact without leaving staging files', async () => {
    const project = await root()
    await writeResolvedContentContractArtifact(project, contract())
    await writeResolvedContentContractArtifact(project, contract())

    expect(await readResolvedContentContract({ root: project })).toMatchObject({
      contract: { format: 'ginko-content-contract', version: 1 },
    })
  })

  it('rejects missing, malformed, oversized, and symbolic-link artifacts', async () => {
    const missing = await root()
    await expect(readResolvedContentContract({ root: missing })).rejects.toThrow(/missing or invalid/)

    const malformed = await root()
    await mkdir(join(malformed, '.ginko'))
    await writeFile(join(malformed, '.ginko/content-contract.json'), '{}')
    await expect(readResolvedContentContract({ root: malformed })).rejects.toThrow(/missing or invalid/)

    const oversized = await root()
    await mkdir(join(oversized, '.ginko'))
    await writeFile(join(oversized, '.ginko/content-contract.json'), Buffer.alloc(4 * 1024 * 1024 + 1))
    await expect(readResolvedContentContract({ root: oversized })).rejects.toThrow(/byte limit/)

    const linked = await root()
    await mkdir(join(linked, '.ginko'))
    const target = join(linked, 'contract.json')
    await writeFile(target, JSON.stringify(contract()))
    await symlink(target, join(linked, '.ginko/content-contract.json'))
    await expect(readResolvedContentContract({ root: linked })).rejects.toThrow(/safe regular file/)

    const linkedDirectory = await root()
    const artifactDirectory = join(linkedDirectory, 'artifact-directory')
    await mkdir(artifactDirectory)
    await writeFile(join(artifactDirectory, 'content-contract.json'), JSON.stringify(contract()))
    const projectWithLinkedDirectory = await root()
    await symlink(artifactDirectory, join(projectWithLinkedDirectory, '.ginko'))
    await expect(readResolvedContentContract({ root: projectWithLinkedDirectory })).rejects.toThrow(
      /directory is unsafe/,
    )
  })
})
