import { describe, expect, test } from 'vitest'
import {
  assertContentReleaseCertification,
  npmTagForVersion
} from '../../../scripts/release/publish.mjs'

describe('release publish policy', () => {
  test('selects the npm channel from the package version', () => {
    expect(npmTagForVersion('0.3.2')).toBe('latest')
    expect(npmTagForVersion('0.4.0-rc.1')).toBe('next')
  })

  test('requires the exact release-certification schema and lanes', () => {
    const certification = {
      schemaVersion: 1,
      lanes: {
        pureRuntimes: 'passed',
        packedConsumerPnpm: 'passed',
        packedConsumerNpm: 'passed',
      },
    }

    expect(() => assertContentReleaseCertification(certification)).not.toThrow()
    expect(() => assertContentReleaseCertification({ ...certification, schemaVersion: 2 }))
      .toThrow('Unsupported release-certification schema')
    expect(() => assertContentReleaseCertification({ schemaVersion: 1, lanes: {} }))
      .toThrow('every required passed lane')
    expect(() => assertContentReleaseCertification({
      schemaVersion: 1,
      lanes: { ...certification.lanes, packedConsumerNpm: 'failed' },
    })).toThrow('every required passed lane')
    expect(() => assertContentReleaseCertification({
      schemaVersion: 1,
      lanes: { ...certification.lanes, unrecognized: 'passed' },
    })).toThrow('every required passed lane')
  })
})
