/**
 * System-computed identity keys on the content envelope. User frontmatter may
 * not define these: the system value always wins and a dev/build warning is
 * emitted so authors notice the shadowed key.
 *
 * Authors who want a stable, rename-proof alias for internal links use `ref`.
 */
export const RESERVED_CONTENT_KEYS = [
  'id',
  'collection',
  'locale',
  'path',
  'canonicalKey',
  'type',
  'file',
  'resolved',
  'variants',
  'localePaths',
  'unprefixedPath',
  // Query-time only: `execute.ts`'s `withDirConfig` stamps the directory
  // `.navigation` config onto variant-resolution (`resolveVariant`) results
  // as a top-level `dir`, so an authored `dir:` frontmatter key would be
  // silently clobbered there. It is not stamped at parse time (path-meta
  // writes the directory name to `file.dir`, not top-level `dir`), so we
  // reserve it here to strip+warn like the other system keys.
  'dir'
] as const

/**
 * Strip reserved system keys from raw user frontmatter/data. Identity keys are
 * stamped later by path-meta; derived localization keys would otherwise be
 * trusted as system state.
 */
export const stripReservedContentKeys = <T extends Record<string, unknown>>(
  source: Record<string, unknown> | null | undefined,
  fileId: string
): Partial<T> => {
  if (!source || typeof source !== 'object') {
    return {}
  }

  const reserved = new Set<string>(RESERVED_CONTENT_KEYS)
  for (const key of RESERVED_CONTENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const hint = key === 'id'
        ? ' Use `ref` for a stable authored alias.'
        : ''
      console.warn(
        `[content] Ignoring reserved frontmatter key "${key}" in "${fileId}"; the system value wins.${hint}`
      )
    }
  }
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !reserved.has(key))) as Partial<T>
}
