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
