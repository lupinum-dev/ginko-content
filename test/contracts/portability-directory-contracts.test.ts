import { link, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parsePortableDocument, type PortableAssetBlobV1 } from '../../packages/content/src/portability'
import {
  readPortableDirectory,
  assertPortablePathSet,
  rebuildPortableDirectoryManifest,
  validatePortableRelativePath,
  verifyPortableDirectory,
  writePortableDirectory,
} from '../../packages/content/src/portability-node'
import { PORTABILITY_CONTRACT_FIXTURES, createPortabilityContractFixture, runPortableDirectoryContract } from '../../packages/content/src/testing/portability-contract'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function temporary(name: string) {
  const root = await mkdtemp(join(tmpdir(), `ginko-portability-${name}-`))
  roots.push(root)
  return root
}

async function fixtureBundle() {
  const contract = createPortabilityContractFixture()
  const document = await parsePortableDocument(PORTABILITY_CONTRACT_FIXTURES.document, contract, 'moved.md')
  return { contract, documents: [document], assets: [] as Array<PortableAssetBlobV1 & { content: Uint8Array }> }
}

describe('Node portable directory contract', () => {
  it('passes the shared observable directory contract', async () => {
    const parent = await temporary('shared')
    await expect(runPortableDirectoryContract({
      firstDestination: join(parent, 'first'),
      secondDestination: join(parent, 'second'),
      write: writePortableDirectory,
      read: readPortableDirectory,
      rebuildManifest: rebuildPortableDirectoryManifest,
      readManifestBytes: destination => readFile(join(destination, '.ginko/portable.json')),
    })).resolves.toEqual({ checks: 3 })
  })

  it('writes, verifies, reads, and deterministically rebuilds a bundle', async () => {
    const parent = await temporary('roundtrip')
    const first = join(parent, 'first')
    const second = join(parent, 'second')
    const bundle = await fixtureBundle()
    await writePortableDirectory(first, bundle)
    await writePortableDirectory(second, bundle)
    const read = await readPortableDirectory(first)
    expect(read.documents.map(item => item.document)).toEqual(bundle.documents)
    const firstManifest = await readFile(join(first, '.ginko/portable.json'))
    expect(await readFile(join(second, '.ginko/portable.json'))).toEqual(firstManifest)
    await rm(join(first, '.ginko/portable.json'))
    await rebuildPortableDirectoryManifest(first)
    expect(await readFile(join(first, '.ginko/portable.json'))).toEqual(firstManifest)
    await expect(verifyPortableDirectory(first)).resolves.toMatchObject({ manifest: { format: 'ginko-content-portable' } })
  })

  it('never overwrites an existing destination', async () => {
    const parent = await temporary('exists')
    const destination = join(parent, 'bundle')
    await mkdir(destination)
    await expect(writePortableDirectory(destination, await fixtureBundle())).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' })
  })

  it('rejects traversal, reserved paths, case-fold collisions, and extra files', async () => {
    expect(() => validatePortableRelativePath('../escape')).toThrowError(expect.objectContaining({ code: 'PATH_INVALID' }))
    expect(() => validatePortableRelativePath('content/CON/file.md')).toThrowError(expect.objectContaining({ code: 'PATH_INVALID' }))
    const parent = await temporary('extra')
    const destination = join(parent, 'bundle')
    await writePortableDirectory(destination, await fixtureBundle())
    await writeFile(join(destination, 'README.txt'), 'not indexed')
    await expect(verifyPortableDirectory(destination)).rejects.toMatchObject({ code: 'PATH_INVALID' })
    await rm(join(destination, 'README.txt'))
    expect(() => assertPortablePathSet(['content/docs/entry/en.md', 'content/docs/entry/EN.md'])).toThrowError(expect.objectContaining({ code: 'PATH_COLLISION' }))
  })

  it('rejects symlinks and bytes changed after manifest creation', async () => {
    const parent = await temporary('hostile')
    const destination = join(parent, 'bundle')
    await writePortableDirectory(destination, await fixtureBundle())
    const document = join(destination, 'content/docs/docs.introduction/en.md')
    await writeFile(document, `${await readFile(document, 'utf8')}changed\n`)
    await expect(verifyPortableDirectory(destination)).rejects.toMatchObject({ code: 'DOCUMENT_INVALID' })
    await rm(document)
    await symlink('/etc/hosts', document)
    await expect(rebuildPortableDirectoryManifest(destination)).rejects.toMatchObject({ code: 'PATH_INVALID' })
  })

  it('rejects hard-link aliases', async () => {
    const parent = await temporary('hardlink')
    const destination = join(parent, 'bundle')
    await writePortableDirectory(destination, await fixtureBundle())
    const document = join(destination, 'content/docs/docs.introduction/en.md')
    await link(document, join(destination, 'content/docs/hardlink.md'))
    await expect(rebuildPortableDirectoryManifest(destination)).rejects.toMatchObject({ code: 'PATH_INVALID' })
  })

  it('accepts a safe moved file but restores canonical paths on write', async () => {
    const parent = await temporary('moved')
    const destination = join(parent, 'bundle')
    await writePortableDirectory(destination, await fixtureBundle())
    const canonical = join(destination, 'content/docs/docs.introduction/en.md')
    const moved = join(destination, 'content/docs/moved.md')
    await rename(canonical, moved)
    await rm(dirname(canonical), { recursive: true })
    await rebuildPortableDirectoryManifest(destination)
    const read = await readPortableDirectory(destination)
    expect(read.documents[0]?.document.canonicalKey).toBe('docs.introduction')
    const restored = join(parent, 'restored')
    await writePortableDirectory(restored, { contract: read.contract, documents: read.documents.map(item => item.document), assets: read.assets })
    await expect(readFile(join(restored, 'content/docs/docs.introduction/en.md'), 'utf8')).resolves.toContain('docs.introduction')
  })
})
