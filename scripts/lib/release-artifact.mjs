export function assertReproduciblePacks(first, second) {
  if (first.filename !== second.filename) {
    throw new Error(`Release archive filenames differ: ${first.filename} != ${second.filename}`)
  }
  if (first.sha256 !== second.sha256) {
    throw new Error(`Release archives differ: ${first.sha256} != ${second.sha256}`)
  }
}
