import { describe, expect, test } from 'vitest'
import { assertProductionAuditClean } from '../../scripts/lib/production-audit.mjs'

describe('production audit policy', () => {
  test('accepts a clean report', () => {
    expect(() => assertProductionAuditClean({ vulnerabilities: {} })).not.toThrow()
  })

  test('rejects every reported vulnerability without exceptions', () => {
    expect(() => assertProductionAuditClean({
      vulnerabilities: {
        indirect: {},
        direct: {},
      },
    })).toThrow('Production audit reported vulnerabilities: direct, indirect.')
  })
})
