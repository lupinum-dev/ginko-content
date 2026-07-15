import { type ChildProcess, spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { NitroConfig } from 'nitropack'
import type { ResolvedContentContext } from '../types/module'
import {
  assertGeneratedSitemaps,
  shouldRunSitemapAssertionOnCompiled
} from './sitemap-assert'

type IntegrationContentContext = Pick<ResolvedContentContext, 'sitemap' | 'provider'>

// Nitro's real config-level hook merging (`hookable`'s `addHooks` ->
// `flatHooks`) treats ANY object value under a hook name -- including a bare
// array -- as a namespace to recurse into (`configHooks[key]` nested under
// `${name}:${index}`), not as "run these handlers for this event". An
// array previously assigned here would therefore silently register under
// keys like `compiled:0`/`compiled:1` that Nitro's real `callHook('compiled',
// ...)` never fires, so NEITHER appended handler would ever run (confirmed
// empirically against a real `nuxi build`). Wrap sequentially into ONE
// function instead -- this is exactly what `hookable`'s own `mergeHooks`
// does for multiple handlers on the same event.
const appendHook = <T>(
  hooks: Record<string, (arg: T) => unknown | Promise<unknown>>,
  name: string,
  handler: (arg: T) => unknown | Promise<unknown>
) => {
  const existing = hooks[name]
  if (!existing) {
    hooks[name] = handler
    return
  }

  hooks[name] = async (arg: T) => {
    await existing(arg)
    await handler(arg)
  }
}

interface CompiledNitroLike {
  options: {
    output: { publicDir: string, serverDir: string }
    static?: boolean
    preset?: string
    rollupConfig?: { output?: { entryFileNames?: string } }
  }
  logger?: { info: (message: string) => void }
}

/**
 * True for Nitro instances whose `'compiled'` event carries no request-servable
 * bundle of its own: a static/`nuxi generate` main build (`static: true` /
 * `preset: 'static'`), and the dedicated PRERENDERER sub-instance nitropack's
 * `prerender()` spins up for every generate/build run (`preset:
 * 'nitro-prerender'`) — Nitro config, including this module's own registered
 * hooks, is inherited when that sub-instance is created
 * (`nitro.options._config` spread), so this hook fires there too, but its
 * bundle bakes `import.meta.prerender === true`
 * (nitropack/dist/rollup/index.mjs), so `runtime/server/api/cache.ts` would
 * answer a fetch with the HTML crawl-links seed instead of JSON.
 */
const isStaticLikeBuild = (nitro: Pick<CompiledNitroLike, 'options'>) =>
  Boolean(nitro.options.static) || nitro.options.preset === 'static' || nitro.options.preset === 'nitro-prerender'

/** Allocate an ephemeral local port by binding to port 0, then release it. */
const allocatePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolvePort, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePort())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => (error ? reject(error) : resolveClose()))
  })
  if (!port) {
    throw new Error('[content] failed to allocate a port for the sitemap-assert build summary fetch.')
  }
  return port
}

const waitForServerReady = async (child: ChildProcess, baseURL: string, timeoutMs = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`[content] the compiled server process for the sitemap-assert build summary fetch exited early (code ${child.exitCode}).`)
    }
    try {
      await fetch(baseURL)
      return
    }
    catch {
      // Not accepting connections yet.
    }
    await delay(100)
  }
  throw new Error('[content] timed out waiting for the compiled server to accept connections for the sitemap-assert build summary fetch.')
}

/**
 * Fetch the small `ContentBuildResult` summary (sitemap collection counts)
 * from the real Nitro-side build (VNEXT §14, §15.2, §25.3), by running the
 * just-compiled server bundle as a real short-lived process and calling the
 * content cache/build route over HTTP — the same approach
 * `test/helpers/production-fixture.ts` already uses to drive a built fixture
 * in e2e tests (a generic compiled Nitro bundle has no in-process way to
 * dispatch a request to itself; only the dedicated `nitro-prerender`
 * preset's own entry template exports a `localFetch` helper for that, and
 * this hook deliberately skips that preset — see `isStaticLikeBuild`).
 *
 * This only ever needs to run AFTER Nuxt's hybrid build has already
 * prerendered (`shouldRunSitemapAssertionOnCompiled` restricts it to
 * mode `'build'`/`'both'`, asserting sitemap output that must already exist
 * on disk) — never before, so it does not need to (and cannot: see
 * `runtime/server/api/cache.ts` for why content-route injection instead
 * relies on crawl-links) supply routes to seed the prerender crawl.
 */
const fetchSitemapCollectionCounts = async (
  nitro: CompiledNitroLike,
  cacheRoute: string
): Promise<Record<string, number>> => {
  const serverFilename = typeof nitro.options.rollupConfig?.output?.entryFileNames === 'string'
    ? nitro.options.rollupConfig.output.entryFileNames
    : 'index.mjs'
  const serverEntrypoint = resolve(nitro.options.output.serverDir, serverFilename)
  const port = await allocatePort()
  const host = '127.0.0.1'
  const baseURL = `http://${host}:${port}`

  const child = spawn(process.execPath, [serverEntrypoint], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host,
      NODE_ENV: 'production'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  try {
    await waitForServerReady(child, baseURL)
    const response = await fetch(`${baseURL}${cacheRoute}`)
    if (!response.ok) {
      throw new Error(`[content] cache/build route failed: [${response.status}] ${response.statusText}`)
    }
    const body = await response.json() as { sitemapByCollection?: Record<string, number> }
    return body.sitemapByCollection || {}
  }
  catch (error) {
    if (stderr && error instanceof Error) {
      error.message += `\n${stderr}`
    }
    throw error
  }
  finally {
    child.kill('SIGTERM')
  }
}

export const registerContentNitroIntegrationHooks = (
  nitroConfig: NitroConfig,
  options: {
    /** The content cache/build route path, e.g. `/api/_content/cache.169.json`. */
    cacheRoute: string
    sitemapPrerenderRoutes?: string[] | (() => string[])
    resolveContentContext?: () => IntegrationContentContext
  },
  contentContext: IntegrationContentContext
) => {
  const getHookContentContext = () => {
    if (!options.resolveContentContext) {
      return contentContext
    }

    try {
      return options.resolveContentContext()
    }
    catch {
      // Nitro config can register hooks before Nuxt module finalization in tests and
      // some Nuxt lifecycle paths. Hook execution should use the resolved context
      // when available, with the registration context as the rebuildable fallback.
      return contentContext
    }
  }

  nitroConfig.hooks ||= {}

  // A non-static (`nuxi build`) hybrid build's prerender phase runs as a
  // SEPARATE `nitro-prerender`-preset sub-instance that shares the same
  // `output.publicDir` with the eventual compiled main server (VNEXT
  // §14.4/§25.2's crawl-links seeding relies on exactly this). Because the
  // cache/build route is unshifted onto `nitro.options.prerender.routes`
  // (`module/nitro-config.ts`) purely to seed that crawl -- only ever for a
  // filesystem-provider build -- Nitro's prerenderer still writes its real
  // (HTML, `import.meta.prerender === true`) response to disk as a static
  // asset at that same route path. The eventual main server's own static-vs-
  // dynamic request-routing decision for that exact path is baked into the
  // compiled bundle as a fixed asset-manifest entry (an exact-URL -> disk
  // path record) generated while the MAIN instance itself builds -- which
  // happens AFTER the prerender sub-instance already ran and wrote that
  // artifact. That manifest entry always wins over the dynamic route once
  // baked, and it does not re-check the file's existence at request time, so
  // deleting the file only once `'compiled'` fires (main OR sub-instance --
  // both already too late) just turns the shadowing 200 HTML response into a
  // 500 ENOENT instead of freeing the dynamic route (confirmed empirically
  // against a real `nuxi build`). The only point early enough to matter is
  // right after the PRERENDER SUB-INSTANCE's own prerendering pass finishes
  // (`'prerender:done'`) -- strictly before the main instance's later build
  // step ever scans `publicDir` to bake that manifest. `'prerender:init'`
  // hands us that sub-instance's `nitro` (and so its `output.publicDir`) to
  // close over; `'prerender:done'` only carries route results, not a nitro
  // ref. `rm(..., { force: true })` makes the delete a safe no-op if nothing
  // was ever written (e.g. dev, or a build where crawling never reached this
  // route). Registered unconditionally for a filesystem-provider build --
  // unrelated to whether sitemap assertion is enabled, since any hybrid
  // build would otherwise ship with a permanently broken cache/build route.
  const usesFilesystemProviderAtRegistration = !contentContext.provider || contentContext.provider === 'filesystem'
  if (usesFilesystemProviderAtRegistration) {
    let prerenderingPublicDir: string | undefined
    appendHook(nitroConfig.hooks as Record<string, any>, 'prerender:init', async (nitro: CompiledNitroLike) => {
      prerenderingPublicDir = nitro.options.output.publicDir
    })
    appendHook(nitroConfig.hooks as Record<string, any>, 'prerender:done', async () => {
      if (!prerenderingPublicDir) {
        return
      }

      const staleArtifactPath = join(prerenderingPublicDir, options.cacheRoute)
      await rm(staleArtifactPath, { recursive: true, force: true })
    })
  }

  if (contentContext.sitemap && contentContext.sitemap.assert?.enabled) {
    appendHook(nitroConfig.hooks as Record<string, any>, 'compiled', async (nitro: CompiledNitroLike) => {
      const hookContentContext = getHookContentContext()
      const hookUsesFilesystemProvider = !hookContentContext.provider || hookContentContext.provider === 'filesystem'
      const assertOptions = hookContentContext.sitemap ? hookContentContext.sitemap.assert as any : undefined
      if (!assertOptions || !shouldRunSitemapAssertionOnCompiled(assertOptions, nitro) || isStaticLikeBuild(nitro)) {
        return
      }

      try {
        await assertGeneratedSitemaps({
          outputPublicDir: nitro.options.output.publicDir,
          options: assertOptions,
          collectionRouteCounts: hookUsesFilesystemProvider
            ? await fetchSitemapCollectionCounts(nitro, options.cacheRoute)
            : {},
          logger: nitro.logger
        })
      }
      catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return
        }
        throw error
      }
    })
  }

  // Content routes are injected via Nitro's crawl-links mechanism instead of
  // this hook (VNEXT §14.4, §25.2, deleted module-time
  // `module/derived-route-discovery.ts`): the content cache/build route is
  // unshifted to the front of `nitro.prerender.routes`
  // (`module/nitro-config.ts`, which also enables `crawlLinks` for the
  // filesystem provider) and, during prerendering, responds with HTML
  // containing one `<a href>` per canonical route the real build produced;
  // Nitro's own crawler extracts those links into this SAME route queue
  // (see `runtime/server/api/cache.ts`). This hook only adds Nuxt Sitemap's
  // own prerender routes, which are unrelated to content route discovery.
  appendHook(nitroConfig.hooks as Record<string, any>, 'prerender:routes', async (routes: Set<string>) => {
    const sitemapPrerenderRoutes = typeof options.sitemapPrerenderRoutes === 'function'
      ? options.sitemapPrerenderRoutes()
      : options.sitemapPrerenderRoutes || []
    for (const route of sitemapPrerenderRoutes) {
      routes.add(route)
    }
  })
}
