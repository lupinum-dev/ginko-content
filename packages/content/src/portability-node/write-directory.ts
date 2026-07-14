import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import type { ResolvedContentContractV1 } from '../cms-contract/types.js'
import { serializePortableDocument, portableDocumentPath } from '../portability/documents.js'
import { portabilityError } from '../portability/errors.js'
import type { PortableAssetBlobV1, PortableDocumentV1 } from '../portability/model.js'
import { rebuildPortableDirectoryManifest, verifyPortableDirectory } from './read-directory.js'
import { validatePortableRelativePath } from './safe-path.js'

export interface WritePortableDirectoryInput {
  contract: ResolvedContentContractV1
  documents: PortableDocumentV1[]
  assets: Array<PortableAssetBlobV1 & { content: Uint8Array }>
}

export async function writePortableDirectory(destination: string, input: WritePortableDirectoryInput): Promise<void> {
  if (await exists(destination)) throw destinationExists()
  const parent = dirname(destination)
  const staging = await mkdtemp(join(parent, `.${basename(destination)}.ginko-staging-`))
  let completed = false
  try {
    const contract = canonicalJsonBytes(input.contract as unknown as JsonValue)
    const contractBytes = new Uint8Array(contract.length + 1)
    contractBytes.set(contract); contractBytes[contractBytes.length - 1] = 10
    await write(staging, '.ginko/content-contract.json', contractBytes)
    for (const document of input.documents) {
      const file = portableDocumentPath(document, input.contract)
      await write(staging, file, new TextEncoder().encode(await serializePortableDocument(document, input.contract)))
    }
    for (const asset of input.assets) await write(staging, asset.file, asset.content)
    await rebuildPortableDirectoryManifest(staging)
    await verifyPortableDirectory(staging)
    if (await exists(destination)) throw destinationExists()
    await rename(staging, destination)
    completed = true
  } catch (error) {
    if (error instanceof Error && error.name === 'GinkoBoundaryError') throw error
    throw portabilityError('PATH_INVALID', 'directory.write', 'Portable directory could not be written safely.')
  } finally {
    if (!completed) await rm(staging, { recursive: true, force: true, maxRetries: 3 })
  }
}

async function write(root: string, file: string, bytes: Uint8Array): Promise<void> {
  validatePortableRelativePath(file)
  const path = join(root, ...file.split('/'))
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT' ? true : false }
}
const destinationExists = () => portabilityError('DESTINATION_EXISTS', 'directory.write', 'Portable destination already exists.')
