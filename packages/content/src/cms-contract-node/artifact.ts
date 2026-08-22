import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { canonicalJsonBytes, hashCanonicalJson, type JsonValue } from '../cms-contract/hash.js'
import { PORTABLE_CONTENT_LIMITS } from '../cms-contract/limits.js'
import type { ResolvedContentContractV1 } from '../cms-contract/types.js'
import { assertResolvedContentContract } from '../cms-contract/validate.js'

export const RESOLVED_CONTENT_CONTRACT_ARTIFACT = '.ginko/content-contract.json' as const

export interface ResolvedContentContractArtifact {
  contract: ResolvedContentContractV1
  sha256: string
}

export interface ReadResolvedContentContractOptions {
  root: string
}

const artifactError = (message: string) => new TypeError(`Resolved Content contract artifact ${message}`)

function artifactPath(root: string): string {
  if (!root) throw artifactError('requires a project root.')
  return join(resolve(root), '.ginko', 'content-contract.json')
}

export async function readResolvedContentContract(
  options: ReadResolvedContentContractOptions,
): Promise<ResolvedContentContractArtifact> {
  const path = artifactPath(options.root)
  let handle
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw artifactError('is not a safe regular file.')
    }
    if (before.size > PORTABLE_CONTENT_LIMITS.contractBytes) {
      throw artifactError('exceeds its byte limit.')
    }
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (
      opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs
      || !opened.isFile()
      || opened.nlink !== 1
    ) {
      throw artifactError('changed while it was being opened.')
    }
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs
      || bytes.byteLength !== after.size
      || bytes.byteLength > PORTABLE_CONTENT_LIMITS.contractBytes
    ) {
      throw artifactError('changed while it was being read.')
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const contract = assertResolvedContentContract(value)
    return {
      contract,
      sha256: await hashCanonicalJson(contract as unknown as JsonValue),
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Resolved Content contract artifact ')) throw error
    throw artifactError('is missing or invalid.')
  } finally {
    await handle?.close()
  }
}

export async function writeResolvedContentContractArtifact(
  root: string,
  contract: ResolvedContentContractV1,
): Promise<ResolvedContentContractArtifact> {
  const validated = assertResolvedContentContract(contract)
  const canonical = canonicalJsonBytes(validated as unknown as JsonValue)
  if (canonical.byteLength + 1 > PORTABLE_CONTENT_LIMITS.contractBytes) {
    throw artifactError('exceeds its byte limit.')
  }
  const directory = join(resolve(root), '.ginko')
  const path = artifactPath(root)
  const temporary = join(directory, `.content-contract.${process.pid}.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const directoryStats = await lstat(directory)
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw artifactError('directory is unsafe.')
  }
  const bytes = new Uint8Array(canonical.byteLength + 1)
  bytes.set(canonical)
  bytes[bytes.length - 1] = 0x0A
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Resolved Content contract artifact ')) throw error
    throw artifactError('could not be written safely.')
  } finally {
    await handle?.close()
    await rm(temporary, { force: true })
  }
  return {
    contract: validated,
    sha256: await hashCanonicalJson(validated as unknown as JsonValue),
  }
}
