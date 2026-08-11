export function assertReproduciblePacks(first, second) {
  if (first.filename !== second.filename) {
    throw new Error(`Release archive filenames differ: ${first.filename} != ${second.filename}`)
  }
  if (first.sha256 !== second.sha256) {
    throw new Error(`Release archives differ: ${first.sha256} != ${second.sha256}`)
  }
}

export function normalizeArchiveEntry(entry) {
  return entry.replace(/\r$/, '').replaceAll('\\', '/')
}

export function parsePackageManagerVersion(output, packageManager) {
  const version = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => /^\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?$/i.test(line))
  if (!version) throw new Error(`Unable to determine the ${packageManager} version.`)
  return version
}
