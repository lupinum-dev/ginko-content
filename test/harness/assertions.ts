import { expect } from 'vitest'

export const expectProviderError = async (
  received: Promise<unknown>,
  code: string,
  details: Record<string, unknown> = {}
) => {
  await expect(received).rejects.toMatchObject({
    statusMessage: code,
    data: {
      code,
      ...details
    }
  })
}

export const expectLocalizedDocument = (
  document: Record<string, unknown> | null | undefined,
  expected: {
    path?: string
    locale?: string
    resolvedLocale?: string
    fallback?: boolean
  }
) => {
  expect(document).toMatchObject({
    ...(expected.path ? { path: expected.path } : {}),
    ...(expected.locale ? { locale: expected.locale } : {}),
    ...(expected.resolvedLocale || expected.fallback !== undefined
      ? {
          resolved: {
            ...(expected.resolvedLocale ? { locale: expected.resolvedLocale } : {}),
            ...(expected.fallback !== undefined ? { fallback: expected.fallback } : {})
          }
        }
      : {})
  })
}
