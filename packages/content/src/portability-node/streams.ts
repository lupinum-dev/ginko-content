import type { Stats } from 'node:fs'

import { portabilityError } from '../portability/errors.js'
import {
  readStableRegularFile as readStableRegularFileCanonical,
  StableFileError,
} from '../cms-contract-node/stable-file.js'

export async function readStableRegularFile(path: string, before: Stats, maximumBytes: number): Promise<Uint8Array> {
  try {
    return await readStableRegularFileCanonical(path, before, maximumBytes)
  } catch (error) {
    throw error instanceof StableFileError ? unsafeFile(error.reason === 'limit') : unsafeFile(false)
  }
}

const unsafeFile = (limit: boolean) => portabilityError(limit ? 'LIMIT_EXCEEDED' : 'PATH_INVALID', 'directory.read', limit ? 'Portable file exceeds its byte limit.' : 'Portable filesystem entry is unsafe.')
