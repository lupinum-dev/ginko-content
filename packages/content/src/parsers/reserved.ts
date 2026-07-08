/**
 * System-computed identity keys on the content envelope. User frontmatter may
 * not define these: the system value always wins and a dev/build warning is
 * emitted so authors notice the shadowed key.
 *
 * The former user-facing "explicit id" alias has been retired — authors who
 * want a stable, rename-proof alias for internal links should use `ref`.
 */
export const RESERVED_CONTENT_KEYS = [
  'id',
  'collection',
  'locale',
  'path',
  'canonicalKey',
  'type',
  'file'
] as const

/**
 * Warn (once per offending key) when raw user frontmatter/data declares a
 * reserved system key. The system value wins regardless; this only surfaces the
 * collision to the author.
 */
export const warnReservedContentKeys = (
  source: Record<string, unknown> | null | undefined,
  fileId: string
): void => {
  if (!source || typeof source !== 'object') {
    return
  }

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
}
