import { portabilityError } from './errors.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const safeByte = (byte: number) =>
  (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) ||
  (byte >= 0x30 && byte <= 0x39) || byte === 0x2E || byte === 0x5F || byte === 0x2D
const device = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i

function assertIdentity(value: string): void {
  if (!value || value !== value.normalize('NFC') || value === '.' || value === '..' || device.test(value)) {
    throw portabilityError('PATH_INVALID', 'portability.serialize', 'Portable identity segment is invalid.')
  }
}

export function encodePortableIdentitySegment(value: string): string {
  assertIdentity(value)
  const bytes = encoder.encode(value)
  let encoded = ''
  for (const byte of bytes) encoded += safeByte(byte) && byte !== 0x25 ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  if (encoder.encode(encoded).length > 240) throw portabilityError('PATH_INVALID', 'portability.serialize', 'Portable identity segment exceeds 240 bytes.')
  return encoded
}

export function decodePortableIdentitySegment(value: string): string {
  if (!value || encoder.encode(value).length > 240 || /%(?![0-9A-F]{2})/.test(value)) {
    throw portabilityError('PATH_INVALID', 'portability.parse', 'Encoded portable identity segment is invalid.')
  }
  const bytes: number[] = []
  for (let index = 0; index < value.length;) {
    if (value[index] === '%') {
      const hex = value.slice(index + 1, index + 3)
      if (!/^[0-9A-F]{2}$/.test(hex)) throw portabilityError('PATH_INVALID', 'portability.parse', 'Percent escapes must use uppercase hexadecimal.')
      bytes.push(Number.parseInt(hex, 16))
      index += 3
    } else {
      const code = value.charCodeAt(index)
      if (!safeByte(code) || code === 0x25) throw portabilityError('PATH_INVALID', 'portability.parse', 'Encoded portable identity segment contains an unsafe byte.')
      bytes.push(code)
      index++
    }
  }
  try {
    const decoded = decoder.decode(Uint8Array.from(bytes))
    assertIdentity(decoded)
    if (encodePortableIdentitySegment(decoded) !== value) throw new Error('non-canonical')
    return decoded
  } catch {
    throw portabilityError('PATH_INVALID', 'portability.parse', 'Encoded portable identity segment is not canonical UTF-8.')
  }
}
