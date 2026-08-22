import { link, mkdtemp, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parsePortableDocument, type PortableAssetBlobV1 } from '../../packages/content/src/portability'
import {
  readPortableDirectory,
  readPortableDirectoryMetadata,
  assertPortablePathSet,
  rebuildPortableDirectoryManifest,
  validatePortableRelativePath,
  verifyPortableDirectoryBounded,
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
    await expect(readPortableDirectory(first)).resolves.toMatchObject({ manifest: { format: 'ginko-content-portable' } })
  })

  it('writes documents and asset bytes lazily from bounded async iterables', async () => {
    const parent = await temporary('streaming')
    const destination = join(parent, 'bundle')
    const bundle = await fixtureBundle()
    const assetContent = PORTABILITY_CONTRACT_FIXTURES.png.bytes
    const assetSha256 = PORTABILITY_CONTRACT_FIXTURES.png.sha256
    const titleField = bundle.contract.collections.docs!.fields[0]!
    bundle.contract.collections.docs!.fields.push({
      ...titleField,
      key: 'hero',
      type: 'image',
      role: null,
      required: false,
      media: { mediaTypes: ['image/png'], aspectRatio: null },
    })
    bundle.documents[0]!.localized.hero = {
      kind: 'local',
      path: `/ginko-assets/${assetSha256}.png`,
      sha256: assetSha256,
      bytes: assetContent.byteLength,
      mediaType: 'image/png',
      originalFilename: 'hero.png',
    }
    let documentFinished = false
    const documents = async function* () {
      yield bundle.documents[0]!
      const staging = (await readdir(parent)).find(name => name.startsWith('.bundle.ginko-staging-'))
      expect(staging).toBeTruthy()
      await expect(readFile(join(parent, staging!, 'content/docs/docs.introduction/en.md'))).resolves.toBeInstanceOf(Buffer)
      documentFinished = true
    }
    const assets = async function* () {
      expect(documentFinished).toBe(true)
      yield {
        sha256: assetSha256,
        file: `public/ginko-assets/${assetSha256}.png`,
        bytes: assetContent.byteLength,
        mediaType: 'image/png' as const,
        content: (async function* () {
          yield assetContent.subarray(0, 16)
          yield assetContent.subarray(16)
        })(),
      }
    }

    await writePortableDirectory(destination, { contract: bundle.contract, documents: documents(), assets: assets() })

    const read = await readPortableDirectory(destination)
    expect(read.documents).toHaveLength(1)
    expect(read.assets).toEqual([
      expect.objectContaining({ sha256: assetSha256, bytes: assetContent.byteLength }),
    ])
    const metadata = await readPortableDirectoryMetadata(destination)
    expect(metadata.documents).toEqual(read.documents)
    expect(metadata.assets).toEqual([
      {
        sha256: assetSha256,
        file: `public/ginko-assets/${assetSha256}.png`,
        bytes: assetContent.byteLength,
        mediaType: 'image/png',
      },
    ])
    expect(metadata.assets[0]).not.toHaveProperty('content')
    await expect(verifyPortableDirectoryBounded(destination)).resolves.toEqual({
      contract: bundle.contract,
      manifest: read.manifest,
    })
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
    for (const character of ['<', '>', ':', '"', '|', '?', '*']) {
      expect(() => validatePortableRelativePath(`content/docs/a${character}b.md`)).toThrowError(expect.objectContaining({ code: 'PATH_INVALID' }))
    }
    expect(() => validatePortableRelativePath(`content/docs/${'a'.repeat(256)}.md`)).toThrowError(expect.objectContaining({ code: 'PATH_INVALID' }))
    const parent = await temporary('extra')
    const destination = join(parent, 'bundle')
    await writePortableDirectory(destination, await fixtureBundle())
    await writeFile(join(destination, 'README.txt'), 'not indexed')
    await expect(verifyPortableDirectoryBounded(destination)).rejects.toMatchObject({ code: 'PATH_INVALID' })
    await rm(join(destination, 'README.txt'))
    expect(() => assertPortablePathSet(['content/docs/entry/en.md', 'content/docs/entry/EN.md'])).toThrowError(expect.objectContaining({ code: 'PATH_COLLISION' }))
    for (const [left, right] of [
      ['content/docs/s.md', 'content/docs/ſ.md'],
      ['content/docs/σ.md', 'content/docs/ς.md'],
      ['content/docs/ss.md', 'content/docs/ß.md'],
    ]) {
      expect(() => assertPortablePathSet([left, right])).toThrowError(expect.objectContaining({ code: 'PATH_COLLISION' }))
    }
  })

  it('rejects symlinks and bytes changed after manifest creation', async () => {
    const parent = await temporary('hostile')
    const destination = join(parent, 'bundle')
    await writePortableDirectory(destination, await fixtureBundle())
    const document = join(destination, 'content/docs/docs.introduction/en.md')
    await writeFile(document, `${await readFile(document, 'utf8')}changed\n`)
    const materializedError = await readPortableDirectory(destination).catch(error => error)
    const boundedError = await verifyPortableDirectoryBounded(destination).catch(error => error)
    expect(materializedError).toMatchObject({ code: 'DOCUMENT_INVALID' })
    expect(boundedError).toMatchObject({ code: materializedError.code })
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
