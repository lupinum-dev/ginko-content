import { describe, expect, test } from 'vitest'
import {
  assertReproduciblePacks,
  normalizeArchiveEntry,
  parsePackageManagerVersion,
} from '../../scripts/lib/release-artifact.mjs'

describe('release artifact reproducibility', () => {
  test('accepts two byte-identical package archives', () => {
    expect(() => assertReproduciblePacks(
      { filename: 'package.tgz', sha256: 'same' },
      { filename: 'package.tgz', sha256: 'same' },
    )).not.toThrow()
  })

  test('rejects changed archive bytes and filenames', () => {
    expect(() => assertReproduciblePacks(
      { filename: 'package.tgz', sha256: 'first' },
      { filename: 'package.tgz', sha256: 'second' },
    )).toThrow('Release archives differ')

    expect(() => assertReproduciblePacks(
      { filename: 'first.tgz', sha256: 'same' },
      { filename: 'second.tgz', sha256: 'same' },
    )).toThrow('Release archive filenames differ')
  })

  test('normalizes Windows tar listings to portable archive paths', () => {
    expect(normalizeArchiveEntry('package\\dist\\module.d.mts\r')).toBe(
      'package/dist/module.d.mts',
    )
  })

  test('records only the semantic package-manager version from Corepack output', () => {
    expect(
      parsePackageManagerVersion(
        '11.15.0\n! Corepack is about to download pnpm-11.15.0.tgz\n',
        'pnpm',
      ),
    ).toBe('11.15.0')
    expect(() => parsePackageManagerVersion('Corepack warning only', 'pnpm')).toThrow(
      'Unable to determine the pnpm version',
    )
  })
})
