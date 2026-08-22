import { constants, type Stats } from 'node:fs'
import { open } from 'node:fs/promises'

export type StableFileFailure = 'limit' | 'unsafe'

export class StableFileError extends Error {
  constructor(readonly reason: StableFileFailure) {
    super(`Stable file ${reason}.`)
    this.name = 'StableFileError'
  }
}

export async function readStableRegularFile(
  path: string,
  before: Stats,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new StableFileError('unsafe')
  }
  if (before.size > maximumBytes) throw new StableFileError('limit')

  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    assertSameFile(before, opened)
    const buffer = new Uint8Array(maximumBytes + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const after = await handle.stat()
    assertSameFile(opened, after)
    if (offset !== after.size) throw new StableFileError('unsafe')
    if (offset > maximumBytes) throw new StableFileError('limit')
    return buffer.slice(0, offset)
  } catch (error) {
    if (error instanceof StableFileError) throw error
    throw new StableFileError('unsafe')
  } finally {
    await handle?.close()
  }
}

function assertSameFile(
  left: Stats,
  right: Stats,
): void {
  if (
    left.dev !== right.dev
    || left.ino !== right.ino
    || left.size !== right.size
    || left.mtimeMs !== right.mtimeMs
    || !right.isFile()
    || right.nlink !== 1
  ) {
    throw new StableFileError('unsafe')
  }
}
