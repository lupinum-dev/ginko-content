import { constants, type Stats } from 'node:fs'
import { open } from 'node:fs/promises'

import { portabilityError } from '../portability/errors.js'

export async function readStableRegularFile(path: string, before: Stats, maximumBytes: number): Promise<Uint8Array> {
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximumBytes) throw unsafeFile(before.size > maximumBytes)
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    assertSame(before, opened)
    const bytes = await handle.readFile()
    const after = await handle.stat()
    assertSame(opened, after)
    if (bytes.length !== after.size || bytes.length > maximumBytes) throw unsafeFile(bytes.length > maximumBytes)
    return Uint8Array.from(bytes)
  } catch (error) {
    if (error instanceof Error && error.name === 'GinkoBoundaryError') throw error
    throw unsafeFile(false)
  } finally {
    await handle?.close()
  }
}

function assertSame(left: Stats, right: Stats): void {
  if (left.dev !== right.dev || left.ino !== right.ino || left.size !== right.size || left.mtimeMs !== right.mtimeMs || !right.isFile() || right.nlink !== 1) throw unsafeFile(false)
}

const unsafeFile = (limit: boolean) => portabilityError(limit ? 'LIMIT_EXCEEDED' : 'PATH_INVALID', 'directory.read', limit ? 'Portable file exceeds its byte limit.' : 'Portable filesystem entry is unsafe.')
