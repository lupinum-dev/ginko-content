export function normalizeCollectionSources (source: string | string[]) {
  return Array.isArray(source) ? source : [source]
}

export function normalizeCollectionExcludes (exclude: string | string[] | undefined) {
  return exclude ? normalizeCollectionSources(exclude) : []
}
