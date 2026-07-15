export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

const encoder = new TextEncoder()
const plainObjectPrototype = Object.prototype

export function canonicalJsonBytes(value: JsonValue): Uint8Array {
  return encoder.encode(canonicalize(value, new Set<object>()))
}

export async function hashCanonicalJson(value: JsonValue): Promise<string> {
  return sha256Hex(canonicalJsonBytes(value))
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    rejectLoneSurrogates(value)
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON requires finite numbers.')
    if (Number.isInteger(value) && Math.abs(value) < 1e21 && !Number.isSafeInteger(value)) {
      throw new TypeError('Canonical JSON integers must be JavaScript safe integers.')
    }
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Canonical JSON does not support ${typeof value} values.`)
  }
  if (ancestors.has(value)) throw new TypeError('Canonical JSON does not support cycles.')

    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) {
          throw new TypeError('Canonical JSON arrays must use Array.prototype.')
        }
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError('Canonical JSON arrays cannot contain holes.')
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          throw new TypeError('Canonical JSON arrays require enumerable data elements.')
        }
      }
      rejectUnexpectedProperties(value, new Set(['length', ...value.map((_, index) => String(index))]))
      return `[${value.map(item => canonicalize(item, ancestors)).join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== plainObjectPrototype && prototype !== null) {
      throw new TypeError('Canonical JSON objects must have a plain or null prototype.')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(descriptors).sort()
    for (const key of keys) {
      rejectLoneSurrogates(key)
      const descriptor = descriptors[key]
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError('Canonical JSON objects require enumerable data properties only.')
      }
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Canonical JSON objects cannot contain symbol properties.')
    }
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(descriptors[key]!.value, ancestors)}`).join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

function rejectUnexpectedProperties(value: unknown[], allowed: Set<string>): void {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) throw new TypeError(`Canonical JSON arrays cannot contain property "${key}".`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Canonical JSON arrays cannot contain symbol properties.')
  }
}

function rejectLoneSurrogates(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new TypeError('Canonical JSON rejects lone UTF-16 surrogates.')
      index++
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new TypeError('Canonical JSON rejects lone UTF-16 surrogates.')
    }
  }
}

const INITIAL_HASH = new Uint32Array([
  0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
  0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
])

const ROUND_CONSTANTS = new Uint32Array([
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
])

export class IncrementalSha256 {
  private readonly state = new Uint32Array(INITIAL_HASH)
  private readonly block = new Uint8Array(64)
  private blockLength = 0
  private bytesHashed = 0

  update(bytes: Uint8Array): void {
    this.bytesHashed += bytes.length
    let offset = 0
    while (offset < bytes.length) {
      const length = Math.min(bytes.length - offset, 64 - this.blockLength)
      this.block.set(bytes.subarray(offset, offset + length), this.blockLength)
      this.blockLength += length
      offset += length
      if (this.blockLength === 64) {
        this.compress(this.block)
        this.blockLength = 0
      }
    }
  }

  digestHex(): string {
    const bitLength = this.bytesHashed * 8
    this.block[this.blockLength++] = 0x80
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength)
      this.compress(this.block)
      this.blockLength = 0
    }
    this.block.fill(0, this.blockLength, 56)
    const high = Math.floor(bitLength / 0x100000000)
    const low = bitLength >>> 0
    writeUint32(this.block, 56, high)
    writeUint32(this.block, 60, low)
    this.compress(this.block)
    return [...this.state].map(word => word.toString(16).padStart(8, '0')).join('')
  }

  private compress(block: Uint8Array): void {
    const words = new Uint32Array(64)
    for (let index = 0; index < 16; index++) {
      words[index] = ((block[index * 4]! << 24) | (block[index * 4 + 1]! << 16) | (block[index * 4 + 2]! << 8) | block[index * 4 + 3]!) >>> 0
    }
    for (let index = 16; index < 64; index++) {
      const left = words[index - 15]!
      const right = words[index - 2]!
      const s0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3)
      const s1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10)
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = this.state
    for (let index = 0; index < 64; index++) {
      const s1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25)
      const choice = (e! & f!) ^ (~e! & g!)
      const temp1 = (h! + s1 + choice + ROUND_CONSTANTS[index]! + words[index]!) >>> 0
      const s0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22)
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!)
      const temp2 = (s0 + majority) >>> 0
      h = g; g = f; f = e; e = (d! + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    const values = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < 8; index++) this.state[index] = (this.state[index]! + values[index]!) >>> 0
  }
}

export async function sha256Hex(bytes: Uint8Array | AsyncIterable<Uint8Array>): Promise<string> {
  const hash = new IncrementalSha256()
  if (bytes instanceof Uint8Array) {
    hash.update(bytes)
  } else {
    for await (const chunk of bytes) {
      if (!(chunk instanceof Uint8Array)) throw new TypeError('SHA-256 chunks must be Uint8Array values.')
      hash.update(chunk)
    }
  }
  return hash.digestHex()
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count))
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value >>> 24
  target[offset + 1] = value >>> 16
  target[offset + 2] = value >>> 8
  target[offset + 3] = value
}
