/** Return the cache endpoint shared by registration and prerendering. */
export const contentCacheRoutePath = (
  apiBaseURL: string,
  options: { dev: boolean, integrity?: string | number }
): string => options.dev || options.integrity === undefined
  ? `${apiBaseURL}/cache.json`
  : `${apiBaseURL}/cache.${options.integrity}.json`
