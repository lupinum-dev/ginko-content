export const isNotFoundError = (error: unknown) => {
  const statusCode = (error as { statusCode?: number, response?: { status?: number } })?.statusCode
    ?? (error as { response?: { status?: number } })?.response?.status
  return statusCode === 404
}
