export type PortabilityErrorCode =
  | 'CONTRACT_INVALID'
  | 'CONTRACT_HASH_MISMATCH'
  | 'DOCUMENT_INVALID'
  | 'IDENTITY_CONFLICT'
  | 'SHARED_FIELD_DIVERGENCE'
  | 'REFERENCE_MISSING'
  | 'REFERENCE_CYCLE'
  | 'MDC_UNSUPPORTED'
  | 'PATH_INVALID'
  | 'PATH_COLLISION'
  | 'LIMIT_EXCEEDED'
  | 'ASSET_MISSING'
  | 'ASSET_TYPE_UNSUPPORTED'
  | 'ASSET_INTEGRITY_FAILED'
  | 'DESTINATION_EXISTS'

export type PortabilityOperation =
  | 'portability.parse'
  | 'portability.serialize'
  | 'portability.hash'
  | 'portability.rebuildManifest'
  | 'portability.validateReferences'
  | 'portability.validateAssets'
  | 'portability.validateMdc'
  | 'directory.read'
  | 'directory.write'
  | 'directory.verify'

export type PortabilityErrorDetails = Record<string, string | number | boolean | null>

export class GinkoBoundaryError extends Error {
  readonly name = 'GinkoBoundaryError'
  readonly boundary: 'portability' | 'directory'
  readonly operation: PortabilityOperation
  readonly code: PortabilityErrorCode
  readonly details: PortabilityErrorDetails
  readonly location: { file: string | null; line: number | null; column: number | null; path: Array<string | number> } | null

  constructor(args: {
    boundary?: 'portability' | 'directory'
    operation: PortabilityOperation
    code: PortabilityErrorCode
    message: string
    details?: PortabilityErrorDetails
    location?: GinkoBoundaryError['location']
  }) {
    super(args.message)
    this.boundary = args.boundary ?? 'portability'
    this.operation = args.operation
    this.code = args.code
    this.details = Object.freeze({ ...(args.details ?? {}) })
    this.location = args.location ?? null
  }
}

export function portabilityError(
  code: PortabilityErrorCode,
  operation: PortabilityOperation,
  message: string,
  details: PortabilityErrorDetails = {},
): GinkoBoundaryError {
  return new GinkoBoundaryError({ code, operation, message, details })
}

export function asPortabilityError(
  error: unknown,
  code: PortabilityErrorCode,
  operation: PortabilityOperation,
  message: string,
): GinkoBoundaryError {
  return error instanceof GinkoBoundaryError ? error : portabilityError(code, operation, message)
}
