import { IncrementalSha256 } from './hash.js'
import { PORTABLE_CONTENT_LIMITS } from './limits.js'
import type { PortableMediaType } from './types.js'

const {
  assetBytes: MAX_BYTES,
  imageDimension: MAX_DIMENSION,
  imagePixels: MAX_PIXELS,
  imageFrames: MAX_FRAMES,
  imageDecodedBytes: MAX_DECODED_BYTES,
} = PORTABLE_CONTENT_LIMITS

export interface VerifiedPublicImage {
  mediaType: PortableMediaType
  bytes: number
  sha256: string
  width: number
  height: number
  frames: number
}

type ImageFacts = Pick<VerifiedPublicImage, 'mediaType' | 'width' | 'height' | 'frames'>

const failure = (message: string): never => {
  throw new TypeError(`Invalid public image: ${message}`)
}

const u16be = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! << 8) | bytes[offset + 1]!
const u16le = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! | (bytes[offset + 1]! << 8)
const u24le = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
const u32be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
const u32le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

function validateDimensions(width: number, height: number): number {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width <= 0 || height <= 0 ||
    width > MAX_DIMENSION || height > MAX_DIMENSION
  ) failure('dimensions exceed the supported range.')
  const pixels = width * height
  if (pixels > MAX_PIXELS) failure('pixel count exceeds the supported limit.')
  return pixels
}

function validateBounds(facts: ImageFacts): ImageFacts {
  const pixels = validateDimensions(facts.width, facts.height)
  if (!Number.isInteger(facts.frames) || facts.frames <= 0 || facts.frames > MAX_FRAMES) {
    failure('frame count exceeds the supported limit.')
  }
  if (pixels * 4 * facts.frames > MAX_DECODED_BYTES) {
    failure('calculated decoded bytes exceed the supported limit.')
  }
  return facts
}

let crcTable: Uint32Array | undefined
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
      let value = index
      for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
      crcTable[index] = value >>> 0
    }
  }
  let crc = 0xFFFFFFFF
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function parsePng(bytes: Uint8Array): ImageFacts {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)) {
    return failure('PNG signature is missing.')
  }
  let offset = 8
  let width = 0
  let height = 0
  let frames = 1
  let sawHeader = false
  let sawData = false
  let sawEnd = false
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) failure('PNG chunk is truncated.')
    const length = u32be(bytes, offset)
    const end = offset + 12 + length
    if (end > bytes.length) failure('PNG chunk length exceeds the file.')
    const type = ascii(bytes, offset + 4, 4)
    const contentEnd = offset + 8 + length
    if (crc32(bytes.subarray(offset + 4, contentEnd)) !== u32be(bytes, contentEnd)) {
      failure(`PNG ${type} checksum does not match.`)
    }
    if (!sawHeader && type !== 'IHDR') failure('PNG IHDR must be the first chunk.')
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) failure('PNG IHDR is invalid.')
      width = u32be(bytes, offset + 8)
      height = u32be(bytes, offset + 12)
      if (bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || ![0, 1].includes(bytes[offset + 20]!)) {
        failure('PNG compression, filter, or interlace method is unsupported.')
      }
      sawHeader = true
    } else if (type === 'IDAT') {
      sawData = true
    } else if (type === 'acTL') {
      if (length !== 8) failure('PNG animation control chunk is invalid.')
      frames = u32be(bytes, offset + 8)
    } else if (type === 'IEND') {
      if (length !== 0 || !sawData) failure('PNG terminal chunk is invalid.')
      sawEnd = true
      offset = end
      break
    }
    offset = end
  }
  if (!sawEnd || offset !== bytes.length) failure('PNG has no exact terminal IEND chunk.')
  return validateBounds({ mediaType: 'image/png', width, height, frames })
}

function parseJpeg(bytes: Uint8Array): ImageFacts {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
    return failure('JPEG start marker is missing.')
  }
  let offset = 2
  let width = 0
  let height = 0
  let components = 0
  let sawEnd = false
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xFF) failure('JPEG marker prefix is invalid.')
    while (bytes[offset] === 0xFF) offset++
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0x00) failure('JPEG marker is truncated.')
    if (marker === 0xD9) {
      sawEnd = true
      break
    }
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) continue
    if (offset + 2 > bytes.length) failure('JPEG segment is truncated.')
    const length = u16be(bytes, offset)
    if (length < 2 || offset + length > bytes.length) failure('JPEG segment length is invalid.')
    const segmentStart = offset + 2
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      if (length < 8) failure('JPEG frame header is truncated.')
      height = u16be(bytes, segmentStart + 1)
      width = u16be(bytes, segmentStart + 3)
      components = bytes[segmentStart + 5]!
      if (length !== 8 + components * 3) failure('JPEG frame components are malformed.')
    }
    offset += length
    if (marker === 0xDA) {
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xFF) continue
        while (bytes[offset] === 0xFF) offset++
        const next = bytes[offset]
        if (next === 0x00 || (next !== undefined && next >= 0xD0 && next <= 0xD7)) {
          offset++
          continue
        }
        offset--
        break
      }
    }
  }
  if (!sawEnd || offset !== bytes.length) failure('JPEG has no exact terminal EOI marker.')
  if (!width || !height || !components) failure('JPEG frame dimensions are missing.')
  return validateBounds({ mediaType: 'image/jpeg', width, height, frames: 1 })
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start
  while (true) {
    if (offset >= bytes.length) failure('GIF sub-block stream is truncated.')
    const length = bytes[offset++]!
    if (length === 0) return offset
    if (offset + length > bytes.length) failure('GIF sub-block exceeds the file.')
    offset += length
  }
}

function parseGif(bytes: Uint8Array): ImageFacts {
  const header = ascii(bytes, 0, 6)
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(header)) return failure('GIF signature is missing.')
  const width = u16le(bytes, 6)
  const height = u16le(bytes, 8)
  const packed = bytes[10]!
  let offset = 13 + ((packed & 0x80) ? 3 * (1 << ((packed & 0x07) + 1)) : 0)
  let frames = 0
  let decodedPixels = 0
  let sawEnd = false
  while (offset < bytes.length) {
    const marker = bytes[offset++]!
    if (marker === 0x3B) {
      sawEnd = true
      break
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) failure('GIF extension is truncated.')
      offset++
      offset = skipGifSubBlocks(bytes, offset)
      continue
    }
    if (marker !== 0x2C || offset + 9 > bytes.length) failure('GIF block marker is invalid.')
    const frameWidth = u16le(bytes, offset + 4)
    const frameHeight = u16le(bytes, offset + 6)
    const framePacked = bytes[offset + 8]!
    if (!frameWidth || !frameHeight) failure('GIF frame dimensions are invalid.')
    decodedPixels += validateDimensions(frameWidth, frameHeight)
    if (decodedPixels * 4 > MAX_DECODED_BYTES) failure('calculated decoded bytes exceed the supported limit.')
    offset += 9
    if (framePacked & 0x80) offset += 3 * (1 << ((framePacked & 0x07) + 1))
    if (offset >= bytes.length || bytes[offset++]! > 11) failure('GIF LZW code size is invalid.')
    offset = skipGifSubBlocks(bytes, offset)
    frames++
  }
  if (!sawEnd || offset !== bytes.length || frames === 0) failure('GIF has no exact terminal trailer or image frame.')
  return validateBounds({ mediaType: 'image/gif', width, height, frames })
}

function parseWebp(bytes: Uint8Array): ImageFacts {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return failure('WebP RIFF signature is missing.')
  }
  if (u32le(bytes, 4) + 8 !== bytes.length) failure('WebP RIFF length does not match the file.')
  let offset = 12
  let width = 0
  let height = 0
  let frames = 0
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) failure('WebP chunk is truncated.')
    const type = ascii(bytes, offset, 4)
    const length = u32le(bytes, offset + 4)
    const data = offset + 8
    const end = data + length
    if (end > bytes.length) failure('WebP chunk length exceeds the file.')
    if (type === 'VP8X') {
      if (length !== 10) failure('WebP extended header is invalid.')
      width = u24le(bytes, data + 4) + 1
      height = u24le(bytes, data + 7) + 1
    } else if (type === 'VP8 ') {
      if (length < 10 || bytes[data + 3] !== 0x9D || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2A) {
        failure('WebP VP8 frame header is invalid.')
      }
      width ||= u16le(bytes, data + 6) & 0x3FFF
      height ||= u16le(bytes, data + 8) & 0x3FFF
      frames ||= 1
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[data] !== 0x2F) failure('WebP lossless frame header is invalid.')
      const bits = u32le(bytes, data + 1)
      width ||= (bits & 0x3FFF) + 1
      height ||= ((bits >>> 14) & 0x3FFF) + 1
      frames ||= 1
    } else if (type === 'ANMF') {
      if (length < 16) failure('WebP animation frame is invalid.')
      frames++
    }
    offset = end + (length & 1)
  }
  if (offset !== bytes.length || !width || !height || !frames) failure('WebP container is incomplete.')
  return validateBounds({ mediaType: 'image/webp', width, height, frames })
}

function parseImage(bytes: Uint8Array): ImageFacts {
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return parsePng(bytes)
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return parseJpeg(bytes)
  if (ascii(bytes, 0, 3) === 'GIF') return parseGif(bytes)
  if (ascii(bytes, 0, 4) === 'RIFF') return parseWebp(bytes)
  return failure('signature is unsupported.')
}

export async function verifyPublicImageBytes(
  source: Uint8Array | AsyncIterable<Uint8Array>,
  claimedMediaType?: string,
): Promise<VerifiedPublicImage> {
  const hash = new IncrementalSha256()
  const chunks: Uint8Array[] = []
  let bytes = 0
  const add = (chunk: Uint8Array) => {
    if (!(chunk instanceof Uint8Array)) failure('byte stream contains a non-Uint8Array chunk.')
    bytes += chunk.length
    if (bytes <= 0 || bytes > MAX_BYTES) failure('byte length exceeds the supported upload limit.')
    hash.update(chunk)
    chunks.push(chunk.slice())
  }
  if (source instanceof Uint8Array) add(source)
  else for await (const chunk of source) add(chunk)
  const all = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.length
  }
  const facts = parseImage(all)
  if (claimedMediaType && claimedMediaType.toLowerCase() !== facts.mediaType) {
    failure(`claimed MIME "${claimedMediaType}" does not match verified ${facts.mediaType}.`)
  }
  return { ...facts, bytes, sha256: hash.digestHex() }
}
