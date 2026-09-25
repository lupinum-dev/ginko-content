/** Why `serializeMdcDocument()` could not write a document. */
export type MdcSerializationIssueCode = 'unrepresentable_value'

/**
 * The document contains a value that no Markdown syntax can hold, so writing it
 * would change its meaning. `path` points to the property in `document.nodes`.
 */
export class MdcSerializationError extends Error {
  readonly code: MdcSerializationIssueCode
  readonly path: Array<string | number>

  constructor(code: MdcSerializationIssueCode, message: string, path: Array<string | number>) {
    super(message)
    this.name = 'MdcSerializationError'
    this.code = code
    this.path = path
  }
}
