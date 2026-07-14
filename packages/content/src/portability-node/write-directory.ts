import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import type { ResolvedContentContractV1 } from '../cms-contract/types.js'
import { serializePortableDocument, portableDocumentPath } from '../portability/documents.js'
import { portabilityError } from '../portability/errors.js'
import type { PortableAssetBlobV1, PortableDocumentV1 } from '../portability/model.js'
import {
  rebuildPortableDirectoryManifest,
  verifyPortableDirectoryBounded,
} from './read-directory.js'
import { validatePortableRelativePath } from './safe-path.js'

export interface WritePortableDirectoryInput {
  contract: ResolvedContentContractV1
  documents: Iterable<PortableDocumentV1> | AsyncIterable<PortableDocumentV1>
  assets: Iterable<PortableAssetWriteInput> | AsyncIterable<PortableAssetWriteInput>
}

export type PortableAssetWriteInput = PortableAssetBlobV1 & {
  content: Uint8Array | AsyncIterable<Uint8Array>
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
    for await (const document of input.documents) {
      const file = portableDocumentPath(document, input.contract)
      await write(staging, file, new TextEncoder().encode(await serializePortableDocument(document, input.contract)))
    }
    for await (const asset of input.assets) await writeAsset(staging, asset)
    await rebuildPortableDirectoryManifest(staging)
    await verifyPortableDirectoryBounded(staging)
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

async function writeAsset(root: string, asset: PortableAssetWriteInput): Promise<void> {
  validatePortableRelativePath(asset.file)
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > 25 * 1024 * 1024) {
    throw portabilityError('LIMIT_EXCEEDED', 'directory.write', 'Portable asset exceeds its byte limit.')
  }
  const path = join(root, ...asset.file.split('/'))
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const handle = await open(path, 'wx', 0o600)
  const hash = createHash('sha256')
  let bytes = 0
  try {
    const chunks = asset.content instanceof Uint8Array ? [asset.content] : asset.content
    for await (const chunk of chunks) {
      if (!(chunk instanceof Uint8Array)) {
        throw portabilityError('ASSET_INTEGRITY_FAILED', 'directory.write', 'Portable asset stream is invalid.')
      }
      bytes += chunk.byteLength
      if (bytes > asset.bytes || bytes > 25 * 1024 * 1024) {
        throw portabilityError('ASSET_INTEGRITY_FAILED', 'directory.write', 'Portable asset stream exceeds its declared length.')
      }
      hash.update(chunk)
      let offset = 0
      while (offset < chunk.byteLength) {
        const result = await handle.write(chunk, offset, chunk.byteLength - offset)
        if (result.bytesWritten < 1) {
          throw portabilityError('ASSET_INTEGRITY_FAILED', 'directory.write', 'Portable asset stream could not be written completely.')
        }
        offset += result.bytesWritten
      }
    }
  } finally {
    await handle.close()
  }
  if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) {
    throw portabilityError('ASSET_INTEGRITY_FAILED', 'directory.write', 'Portable asset stream does not match its declared identity.')
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
