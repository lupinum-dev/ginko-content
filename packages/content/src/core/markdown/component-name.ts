/** Canonical component identity shared by parsing, validation, and rendering. */
export const canonicalizePortableComponentName = (value: string) =>
  value
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_.\s]+/g, '-')
    .toLowerCase()
