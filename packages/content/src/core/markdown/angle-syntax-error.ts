/** Strict angle-component parse failures. Kept free of parser types for public declarations. */

export type AngleComponentSyntaxIssueCode =
  | 'duplicate_prop'
  | 'duplicate_slot'
  | 'invalid_binding'
  | 'invalid_prop'
  | 'mismatched_tag'
  | 'misplaced_slot'
  | 'mixed_default_slot'
  | 'orphan_close'
  | 'unclosed_tag'

export class AngleComponentSyntaxError extends Error {
  readonly code: AngleComponentSyntaxIssueCode
  readonly line: number
  readonly column: number
  readonly openingTag: string

  constructor(
    code: AngleComponentSyntaxIssueCode,
    message: string,
    location: { line: number; column: number; openingTag: string },
  ) {
    super(message)
    this.name = 'AngleComponentSyntaxError'
    this.code = code
    this.line = location.line
    this.column = location.column
    this.openingTag = location.openingTag
  }
}
