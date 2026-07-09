export interface GeneratedLinkFailure {
  sourceFile: string
  reference: string
  reason: string
}

export function generatedFileCandidates(pathname: string): string[]
export function collectGeneratedLinkFailures(publicDir: string): Promise<GeneratedLinkFailure[]>
export function assertGeneratedLinkIntegrity(publicDir: string): Promise<void>
