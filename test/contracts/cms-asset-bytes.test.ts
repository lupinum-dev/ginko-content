import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { verifyPublicImageBytes } from '../../packages/content/src/cms-contract'

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ),
)
const gif = Uint8Array.from(
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
)
const jpeg = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
    'base64',
  ),
)
const webp = Uint8Array.from(
  Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64'),
).subarray(0, -4)

async function* chunks(bytes: Uint8Array) {
  for (let offset = 0; offset < bytes.length; offset += 7) {
    yield bytes.subarray(offset, offset + 7)
  }
}

describe('public image byte verification', () => {
  it('incrementally hashes and fully identifies a PNG', async () => {
    const result = await verifyPublicImageBytes(chunks(png), 'image/png')
    expect(result).toEqual({
      mediaType: 'image/png',
      bytes: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      width: 1,
      height: 1,
      frames: 1,
    })
  })

  it('identifies a complete GIF by bytes rather than filename metadata', async () => {
    await expect(verifyPublicImageBytes(gif, 'image/gif')).resolves.toMatchObject({
      mediaType: 'image/gif',
      width: 1,
      height: 1,
      frames: 1,
    })
  })

  it('rejects GIF frame dimensions that exceed the decoded image bounds', async () => {
    const forged = gif.slice()
    const descriptor = forged.indexOf(0x2C)
    forged[descriptor + 5] = 0xFF
    forged[descriptor + 6] = 0xFF
    forged[descriptor + 7] = 0xFF
    forged[descriptor + 8] = 0xFF

    await expect(verifyPublicImageBytes(forged, 'image/gif')).rejects.toThrow(/dimension|pixel|decoded/i)
  })

  it.each([
    ['image/jpeg', jpeg],
    ['image/webp', webp],
  ] as const)('parses a complete %s container', async (mediaType, bytes) => {
    await expect(verifyPublicImageBytes(bytes, mediaType)).resolves.toMatchObject({
      mediaType,
      width: 1,
      height: 1,
      frames: 1,
    })
  })

  it('rejects MIME mismatches, truncation, appended bytes, and unsupported active formats', async () => {
    await expect(verifyPublicImageBytes(png, 'image/jpeg')).rejects.toThrow(/does not match/i)
    await expect(verifyPublicImageBytes(png.subarray(0, png.length - 1))).rejects.toThrow(/terminal|chunk/i)
    await expect(verifyPublicImageBytes(Uint8Array.from([...gif, 0]))).rejects.toThrow(/terminal/i)
    await expect(
      verifyPublicImageBytes(new TextEncoder().encode('<svg><script/></svg>'), 'image/svg+xml'),
    ).rejects.toThrow(/unsupported/i)
  })

  it('rejects forged PNG checksums', async () => {
    const forged = png.slice()
    forged[20] = forged[20]! ^ 1
    await expect(verifyPublicImageBytes(forged, 'image/png')).rejects.toThrow(/checksum/i)
  })
})
