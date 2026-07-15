import { describe, expect, it } from 'vitest'
import { isExpectedNuxtPayloadCancellation } from '../helpers/browser-failures'

describe('browser failure classification', () => {
  const baseURL = 'http://127.0.0.1:40457'

  it('ignores only aborted same-origin Nuxt payload requests', () => {
    expect(isExpectedNuxtPayloadCancellation(
      `${baseURL}/de/leitfaden/erste-schritte/_payload.json?build-id`,
      'net::ERR_ABORTED',
      baseURL
    )).toBe(true)

    expect(isExpectedNuxtPayloadCancellation(
      `${baseURL}/api/_content/query`,
      'net::ERR_ABORTED',
      baseURL
    )).toBe(false)
    expect(isExpectedNuxtPayloadCancellation(
      `${baseURL}/de/leitfaden/erste-schritte/_payload.json?build-id`,
      'net::ERR_FAILED',
      baseURL
    )).toBe(false)
    expect(isExpectedNuxtPayloadCancellation(
      'https://example.test/de/leitfaden/erste-schritte/_payload.json?build-id',
      'net::ERR_ABORTED',
      baseURL
    )).toBe(false)
  })
})
