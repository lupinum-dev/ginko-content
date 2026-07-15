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
