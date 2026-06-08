import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve as resolveFilePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Nuxt } from '@nuxt/schema'
import type { ContentConfig } from '../types/config'
import type { ContentContext, ModuleOptions } from '../types/module'
import type { createSearchRuntimeConfig } from './options'
import { normalizeAgentRouteOptions } from './agent-options'
import {
  collectRawMarkdownLinksFromLlms,
  collectRawMarkdownRoutesFromGeneratedFrontmatter,
  publicOutputPath,
  rawMarkdownIndexRouteForRawRoute
} from './static-output-routes'

type SearchRuntime = ReturnType<typeof createSearchRuntimeConfig> | false

const hookNuxtBoundary = <T>(
  nuxt: { hook: unknown },
  name: string,
  callback: (payload: T) => void | Promise<void>
) => {
  const hook = nuxt.hook as (hookName: string, callback: (payload: T) => void | Promise<void>) => void
  hook(name, callback)
}

interface StaticOutputGenerationOptions {
  nuxt: Nuxt
  options: ModuleOptions
  appContentConfig: ContentConfig
  contentContext: Pick<ContentContext, 'provider'>
  resolvedI18n: Pick<ContentContext, 'locales' | 'defaultLocale'>
  resolveRuntimeModule: (path: string) => string
  getSearchRuntime: () => SearchRuntime
}

export const registerStaticOutputGeneration = ({
  nuxt,
  options,
  appContentConfig,
  contentContext,
  resolvedI18n,
  resolveRuntimeModule,
  getSearchRuntime
}: StaticOutputGenerationOptions) => {
  if (nuxt.options.dev) return

  hookNuxtBoundary(nuxt, 'nitro:build:before', (nitro: {
    hooks: { hook: (name: string, callback: (payload: any) => void | Promise<void>) => void }
    options: { output: { publicDir?: string } }
  }) => {
    nitro.hooks.hook('prerender:init', (prerenderer: any) => {
      prerenderer.hooks.hook('compiled', async () => {
        const searchRuntime = getSearchRuntime()
        const publicDir = nitro.options.output.publicDir
          || (nuxt.options as { nitro?: { output?: { publicDir?: string } } }).nitro?.output?.publicDir
          || resolveFilePath(nuxt.options.rootDir, '.output/public')
        const serverFilename = typeof prerenderer.options.rollupConfig?.output?.entryFileNames === 'string'
          ? prerenderer.options.rollupConfig.output.entryFileNames
          : 'index.mjs'
        const serverEntrypoint = resolveFilePath(prerenderer.options.output.serverDir, serverFilename)
        const { localFetch } = await import(pathToFileURL(serverEntrypoint).href)

        if (
          searchRuntime !== false
          && searchRuntime.engine !== 'cms'
          && (!contentContext.provider || contentContext.provider === 'filesystem')
        ) {
          const response = await localFetch(searchRuntime.indexURL)

          if (!response.ok) {
            throw new Error(`Failed to generate search index: [${response.status}] ${response.statusText}`)
          }

          const json = await response.text()
          const indexPath = publicOutputPath(publicDir, searchRuntime.indexURL)
          mkdirSync(dirname(indexPath), { recursive: true })
          writeFileSync(indexPath, json, 'utf8')

          if (searchRuntime.engine === 'pagefind') {
            const records = JSON.parse(json)
            const { writePagefindIndex } = await import(resolveRuntimeModule('./server/pagefind.js'))
            await writePagefindIndex(records, resolveFilePath(publicDir, 'pagefind'))
          }
        }

        const agentRoutes = normalizeAgentRouteOptions(options)
        if (agentRoutes.routes && agentRoutes.prerender && appContentConfig.agent) {
          const defaultLocale = appContentConfig.agent.site?.defaultLocale || resolvedI18n.defaultLocale
          const locales = appContentConfig.agent.site?.locales?.length
            ? appContentConfig.agent.site.locales
            : resolvedI18n.locales
          const llmsRoutes = [
            '/llms.txt',
            '/llms-full.txt',
            ...locales
              .filter(locale => locale && locale !== defaultLocale)
              .flatMap(locale => [`/${locale}/llms.txt`, `/${locale}/llms-full.txt`])
          ]
          const markdownRoutes = new Set<string>()

          for (const route of llmsRoutes) {
            const response = await localFetch(route)
            if (!response.ok) {
              throw new Error(`Failed to generate agent markdown route ${route}: [${response.status}] ${response.statusText}`)
            }
            const body = await response.text()
            const outputPath = publicOutputPath(publicDir, route)
            mkdirSync(dirname(outputPath), { recursive: true })
            writeFileSync(outputPath, body, 'utf8')
            if (/\/llms\.txt$/i.test(route)) {
              collectRawMarkdownLinksFromLlms(body, appContentConfig.agent.site?.url).forEach(link => markdownRoutes.add(link))
            } else if (/\/llms-full\.txt$/i.test(route)) {
              collectRawMarkdownRoutesFromGeneratedFrontmatter(body).forEach(link => markdownRoutes.add(link))
            }
          }

          for (const route of markdownRoutes) {
            const response = await localFetch(route)
            if (!response.ok) {
              throw new Error(`Failed to generate agent markdown route ${route}: [${response.status}] ${response.statusText}`)
            }
            const body = await response.text()
            const outputPath = publicOutputPath(publicDir, route)
            mkdirSync(dirname(outputPath), { recursive: true })
            writeFileSync(outputPath, body, 'utf8')

            const indexRoute = rawMarkdownIndexRouteForRawRoute(route)
            if (indexRoute) {
              const indexPath = publicOutputPath(publicDir, indexRoute)
              mkdirSync(dirname(indexPath), { recursive: true })
              writeFileSync(indexPath, body, 'utf8')
            }
          }
        }
      })
    })
  })
}
