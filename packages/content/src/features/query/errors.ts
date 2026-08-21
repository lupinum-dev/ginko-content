export const isNotFoundError = (error: unknown) => {
  const statusCode = (error as { statusCode?: number, response?: { status?: number } })?.statusCode
    ?? (error as { response?: { status?: number } })?.response?.status
  return statusCode === 404
}

/** Apply the public query API's one shared rule for missing collections. */
export const withNotFoundFallback = async <T>(
  request: () => Promise<T>,
  fallback: T
): Promise<T> => {
  try {
    return await request()
  } catch (error) {
    if (isNotFoundError(error)) return fallback
    throw error
  }
}
