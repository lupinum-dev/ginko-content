import { describe, expect, test } from 'vitest'
import { evaluateProductionAudit } from '../../scripts/lib/production-audit.mjs'

const acceptedReport = {
  vulnerabilities: {
    'archiver': {
      name: 'archiver',
      severity: 'high',
      isDirect: false,
      via: ['archiver-utils', 'readdir-glob', 'zip-stream'],
      nodes: ['node_modules/archiver'],
    },
    'archiver-utils': {
      name: 'archiver-utils',
      severity: 'high',
      isDirect: false,
      via: ['glob'],
      nodes: ['node_modules/archiver-utils'],
    },
    'brace-expansion': {
      name: 'brace-expansion',
      severity: 'high',
      isDirect: false,
      via: [{
        url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
      }],
      nodes: [
        'node_modules/archiver-utils/node_modules/brace-expansion',
        'node_modules/readdir-glob/node_modules/brace-expansion',
      ],
    },
    'glob': {
      name: 'glob',
      severity: 'high',
      isDirect: false,
      via: ['minimatch'],
      nodes: ['node_modules/archiver-utils/node_modules/glob'],
    },
    'minimatch': {
      name: 'minimatch',
      severity: 'high',
      isDirect: false,
      via: ['brace-expansion'],
      nodes: [
        'node_modules/archiver-utils/node_modules/minimatch',
        'node_modules/readdir-glob/node_modules/minimatch',
      ],
    },
    'nitropack': {
      name: 'nitropack',
      severity: 'high',
      isDirect: true,
      via: ['archiver'],
      nodes: ['node_modules/nitropack'],
    },
    'readdir-glob': {
      name: 'readdir-glob',
      severity: 'high',
      isDirect: false,
      via: ['minimatch'],
      nodes: ['node_modules/readdir-glob'],
    },
    'zip-stream': {
      name: 'zip-stream',
      severity: 'high',
      isDirect: false,
      via: ['archiver-utils'],
      nodes: ['node_modules/zip-stream'],
    },
  },
}

describe('production audit exception', () => {
  test('accepts only the known Nitro and Archiver advisory path before expiry', () => {
    expect(evaluateProductionAudit(
      acceptedReport,
      new Date('2026-07-26T00:00:00.000Z'),
    )).toEqual({
      acceptedException: true,
      advisory: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
      expiresAt: '2026-08-02T23:59:59.999Z',
    })
  })

  test('rejects another advisory', () => {
    const report = structuredClone(acceptedReport)
    report.vulnerabilities['brace-expansion'].via[0].url
      = 'https://github.com/advisories/GHSA-other'

    expect(() => evaluateProductionAudit(report, new Date('2026-07-26')))
      .toThrow('Production audit advisory changed')
  })

  test('rejects a changed dependency path', () => {
    const report = structuredClone(acceptedReport)
    report.vulnerabilities.archiver.nodes = ['node_modules/other/node_modules/archiver']

    expect(() => evaluateProductionAudit(report, new Date('2026-07-26')))
      .toThrow('Production audit path changed for archiver')
  })

  test('rejects an additional vulnerability', () => {
    const report = structuredClone(acceptedReport)
    report.vulnerabilities.unrelated = {
      name: 'unrelated',
      severity: 'low',
      isDirect: true,
      via: [],
      nodes: ['node_modules/unrelated'],
    }

    expect(() => evaluateProductionAudit(report, new Date('2026-07-26')))
      .toThrow('outside the temporary exception')
  })

  test('rejects the known path after expiry', () => {
    expect(() => evaluateProductionAudit(
      acceptedReport,
      new Date('2026-08-03T00:00:00.000Z'),
    )).toThrow('Temporary production-audit exception expired')
  })

  test('passes a clean audit without using the exception', () => {
    expect(evaluateProductionAudit({ vulnerabilities: {} })).toEqual({
      acceptedException: false,
    })
  })
})
