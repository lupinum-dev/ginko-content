const CONTENT_RELEASE_LANES = [
  'packedConsumerNpm',
  'packedConsumerPnpm',
  'pureRuntimes',
]

export function npmTagForVersion(version) {
  return version.includes('-') ? 'next' : 'latest'
}

export function assertContentReleaseCertification(certification) {
  if (certification?.schemaVersion !== 1) {
    throw new Error('Unsupported release-certification schema.')
  }

  const lanes = certification.lanes
  const names = lanes && typeof lanes === 'object'
    ? Object.keys(lanes).sort()
    : []
  if (
    names.length !== CONTENT_RELEASE_LANES.length ||
    names.some((name, index) => name !== CONTENT_RELEASE_LANES[index]) ||
    CONTENT_RELEASE_LANES.some(name => lanes[name] !== 'passed')
  ) {
    throw new Error('The release certification does not contain every required passed lane.')
  }
}
