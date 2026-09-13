import { resolve } from 'node:path'
import { buildPackageAgentDocs, verifyPackageAgentDocs } from './package-agent-docs.mjs'

const root = resolve(import.meta.dirname, '..')
const packageRoot = resolve(root, 'packages/content')
const sourceRoot = resolve(root, 'docs/.output/public/raw')
await buildPackageAgentDocs({
  packageRoot,
  sourceRoot,
  startRoutes: ['/docs/get-started/quickstart', '/docs/reference/package-exports'],
})
const manifest = await verifyPackageAgentDocs(packageRoot, { sourceRoot })
console.log(`Packaged ${manifest.pages.length} documentation pages for ${manifest.name}@${manifest.version}.`)
