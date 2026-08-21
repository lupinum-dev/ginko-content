/**
 * Single source of truth for the content cache/build route path.
 *
 * The exact same path must be produced by server-handler registration
 * (`module/server-handlers.ts`), prerender route injection
 * (`module/nitro-config.ts`), and the post-build sitemap assertion consumer
 * (`module/integration-hooks.ts`). Dev has no integrity suffix; production
 * embeds the build integrity so stale payload routes are never served.
 */
export const contentCacheRoutePath = (
  apiBaseURL: string,
  options: { dev: boolean, integrity?: string | number }
): string => options.dev || options.integrity === undefined
  ? `${apiBaseURL}/cache.json`
  : `${apiBaseURL}/cache.${options.integrity}.json`
