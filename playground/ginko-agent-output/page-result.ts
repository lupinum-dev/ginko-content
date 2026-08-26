interface AsyncPageResult<T> {
  data: { value: T | null | undefined }
  error: { value: unknown }
}

export function resolveLoadedPage<T>(results: readonly AsyncPageResult<T>[]) {
  const failure = results.find(result => result.error.value)?.error.value
  if (failure) throw failure
  return results.find(result => result.data.value)?.data.value
}
