const TEMPORARY_EXCEPTION = {
  advisory: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
  expiresAt: '2026-08-02T23:59:59.999Z',
  vulnerabilities: {
    'archiver': {
      direct: false,
      nodes: ['node_modules/archiver'],
      via: ['archiver-utils', 'readdir-glob', 'zip-stream'],
    },
    'archiver-utils': {
      direct: false,
      nodes: ['node_modules/archiver-utils'],
      via: ['glob'],
    },
    'brace-expansion': {
      direct: false,
      nodes: [
        'node_modules/archiver-utils/node_modules/brace-expansion',
        'node_modules/readdir-glob/node_modules/brace-expansion',
      ],
      via: [],
    },
    'glob': {
      direct: false,
      nodes: ['node_modules/archiver-utils/node_modules/glob'],
      via: ['minimatch'],
    },
    'minimatch': {
      direct: false,
      nodes: [
        'node_modules/archiver-utils/node_modules/minimatch',
        'node_modules/readdir-glob/node_modules/minimatch',
      ],
      via: ['brace-expansion'],
    },
    'nitropack': {
      direct: true,
      nodes: ['node_modules/nitropack'],
      via: ['archiver'],
    },
    'readdir-glob': {
      direct: false,
      nodes: ['node_modules/readdir-glob'],
      via: ['minimatch'],
    },
    'zip-stream': {
      direct: false,
      nodes: ['node_modules/zip-stream'],
      via: ['archiver-utils'],
    },
  },
}

const sorted = values => [...values].sort()

const sameStrings = (left, right) =>
  JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))

function advisoryUrls(via) {
  return via
    .filter(item => typeof item === 'object' && item !== null)
    .map(item => item.url)
}

function dependencyNames(via) {
  return via.filter(item => typeof item === 'string')
}

export function evaluateProductionAudit(report, now = new Date()) {
  const vulnerabilities = report?.vulnerabilities
  if (!vulnerabilities || Object.keys(vulnerabilities).length === 0) {
    return { acceptedException: false }
  }

  if (now.getTime() > Date.parse(TEMPORARY_EXCEPTION.expiresAt)) {
    throw new Error(
      `Temporary production-audit exception expired at ${TEMPORARY_EXCEPTION.expiresAt}.`,
    )
  }

  const actualNames = Object.keys(vulnerabilities)
  const expectedNames = Object.keys(TEMPORARY_EXCEPTION.vulnerabilities)
  if (!sameStrings(actualNames, expectedNames)) {
    throw new Error('Production audit contains vulnerabilities outside the temporary exception.')
  }

  for (const name of expectedNames) {
    const actual = vulnerabilities[name]
    const expected = TEMPORARY_EXCEPTION.vulnerabilities[name]
    if (
      actual.name !== name
      || actual.severity !== 'high'
      || actual.isDirect !== expected.direct
      || !sameStrings(actual.nodes ?? [], expected.nodes)
      || !sameStrings(dependencyNames(actual.via ?? []), expected.via)
    ) {
      throw new Error(`Production audit path changed for ${name}.`)
    }
  }

  const advisories = Object.values(vulnerabilities)
    .flatMap(vulnerability => advisoryUrls(vulnerability.via ?? []))
  if (
    advisories.length !== 1
    || advisories[0] !== TEMPORARY_EXCEPTION.advisory
  ) {
    throw new Error('Production audit advisory changed from the temporary exception.')
  }

  return {
    acceptedException: true,
    advisory: TEMPORARY_EXCEPTION.advisory,
    expiresAt: TEMPORARY_EXCEPTION.expiresAt,
  }
}
