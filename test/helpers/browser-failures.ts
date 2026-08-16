export function isExpectedNuxtPayloadCancellation (
  url: string,
  errorText: string | undefined,
  baseURL: string
) {
  if (errorText !== 'net::ERR_ABORTED') return false

  try {
    const requestURL = new URL(url)
    return requestURL.origin === new URL(baseURL).origin &&
      requestURL.pathname.endsWith('/_payload.json')
  } catch {
    return false
  }
}

export function removeExpectedNuxtPayloadCancellationDiagnostics (
  failures: string[],
  cancellationCount: number
) {
  const remaining = [...failures]

  for (let index = 0; index < cancellationCount; index++) {
    const diagnosticIndex = remaining.findIndex(failure => failure === 'console error: [NUXT_E7002]')
    if (diagnosticIndex === -1) break
    remaining.splice(diagnosticIndex, 1)
  }

  return remaining
}
