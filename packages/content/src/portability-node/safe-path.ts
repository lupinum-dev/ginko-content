import { posix } from 'node:path'

import { portabilityError } from '../portability/errors.js'

const device = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i
const encoder = new TextEncoder()

export function validatePortableRelativePath(value: string): string {
  if (!value || value !== value.normalize('NFC') || value.includes('\\') || value.startsWith('/') || posix.isAbsolute(value) || encoder.encode(value).length > 512) throw invalidPath()
  const segments = value.split('/')
  if (segments.length > 32 || segments.some(segment => !validSegment(segment))) throw invalidPath()
  return value
}

export function assertPortablePathSet(values: Iterable<string>): void {
  const folded = new Set<string>()
  for (const value of values) {
    const normalized = validatePortableRelativePath(value)
    const key = portableCaseFold(normalized)
    if (folded.has(key)) throw portabilityError('PATH_COLLISION', 'directory.verify', 'Portable paths collide after Unicode case folding.')
    folded.add(key)
  }
}

function validSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..' || segment.endsWith('.') || segment.endsWith(' ') || device.test(segment)) return false
  return ![...segment].some(character => {
    const code = character.codePointAt(0)!
    return code === 0 || code <= 31 || code === 127
  })
}

export const portableCaseFold = (value: string) => value.normalize('NFC').toLowerCase()
const invalidPath = () => portabilityError('PATH_INVALID', 'directory.verify', 'Portable directory path is invalid.')
