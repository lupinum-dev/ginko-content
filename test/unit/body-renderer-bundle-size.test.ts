import { describe, expect, test } from 'vitest'
import { measureBrowserBundle } from '../helpers/browser-bundle-size'

// `@lupinum/ginko-content/body-renderer` renders an already parsed tree. Its
// browser bundle must not pull the MDC parser, zod, or the `cms-contract`
// barrel. Before the direct `render-policy` import it shipped ~184 KB gzip;
// the lean graph is ~7 KB. The budget leaves headroom for renderer features,
// not for another parser.
const BODY_RENDERER_GZIP_BUDGET = 12 * 1024

const forbiddenModules = [
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:comark|@comark|zod|shiki|katex)\//,
  /cms-contract\/(?:index|mdc|provider-wire|build|validate)\.ts$/,
  /core\/markdown\/parse-comark\.ts$/
]

describe('body renderer browser bundle', () => {
  test('stays within the gzip budget and excludes parser modules', async () => {
    const report = await measureBrowserBundle('packages/content/src/runtime/app/components/body-renderer.ts')

    const leaked = report.inputs.filter(input => forbiddenModules.some(pattern => pattern.test(input)))
    expect(leaked).toEqual([])
    expect(report.gzip).toBeLessThanOrEqual(BODY_RENDERER_GZIP_BUDGET)
  })
})
