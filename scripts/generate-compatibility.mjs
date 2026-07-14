import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Single source of truth for packages/content/compatibility.json.
//
// The generated file has three derived-or-pinned parts:
//   - releaseStack: @lupinum/ginko-content comes from its package.json version;
//     the cross-repo entries are pinned here (their manifests live in ginko-cms).
//   - tracked: the pinned-tools map — the one place these ranges are declared.
//   - intentionalHolds: prose rationale for deliberate version pins.
//
// Run with no args to (re)write the committed file. Run with --check to fail
// when the committed file has drifted from what this generator would produce.

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputPath = resolve(repoRoot, 'packages/content/compatibility.json')

const NAME = 'Ginko Content release compatibility'

// Cross-repo release-stack pins (manifests not present in this repo).
const RELEASE_STACK_PINS = {
  '@lupinum/ginko-cms': '0.2.0-rc.1',
  '@lupinum/ginko-cms-convex': '0.2.0-rc.1',
  '@lupinum/ginko-cms-contract': '0.2.0-rc.1',
}

// The pinned-tools map: dependency name -> allowed version ranges across the
// monorepo. This is the single place these ranges are declared; the
// compatibility-matrix check (scripts/check-compatibility-matrix.mjs) enforces
// that every workspace package.json conforms to it.
const TRACKED = {
  '@convex-dev/better-auth': ['^0.12.5', '0.12.5'],
  '@nuxtjs/mcp-toolkit': ['^0.16.1', '0.16.1'],
  'better-auth': ['1.6.23'],
  'convex': ['1.38.0', '^1.38.0'],
  'convex-helpers': ['^0.1.117', '0.1.117'],
  'h3': ['1.15.11'],
  'nuxt': ['^4.4.8', '4.4.8', '>=4.4.7 <5'],
  'typescript': ['~5.9.3', '5.9.3'],
  'vite': ['^7.3.6', '7.3.6'],
  'vitest': ['^4.1.10', '>=4.1.6 <5'],
  'vue-tsc': ['^3.3.7', '3.3.7'],
  'zod': ['4.4.3', '^4.4.3'],
}

const INTENTIONAL_HOLDS = [
  'h3 stays on 1.15.11 until h3 2 leaves release-candidate status and Nuxt ecosystem peers accept it.',
  'Ginko Content remains CMS-neutral; CMS integration is limited to runtime-neutral contract/import subpaths.',
]

// Render the tracked map with each range array kept compact on one line
// (the value arrays are short pins; inlining them keeps the file readable).
function renderTracked(tracked) {
  const entries = Object.entries(tracked).map(([name, ranges]) => {
    const inline = ranges.map(range => JSON.stringify(range)).join(', ')
    return `    ${JSON.stringify(name)}: [${inline}]`
  })
  return `{\n${entries.join(',\n')}\n  }`
}

function generate() {
  const contentManifest = JSON.parse(
    readFileSync(resolve(repoRoot, 'packages/content/package.json'), 'utf8'),
  )

  const releaseStack = {
    '@lupinum/ginko-content': contentManifest.version,
    ...RELEASE_STACK_PINS,
  }

  // Assemble by field so the tracked map stays inline while the rest of the
  // document uses standard 2-space pretty-printing.
  return `{
  "name": ${JSON.stringify(NAME)},
  "releaseStack": ${JSON.stringify(releaseStack, null, 2).replace(/\n/g, '\n  ')},
  "tracked": ${renderTracked(TRACKED)},
  "intentionalHolds": ${JSON.stringify(INTENTIONAL_HOLDS, null, 2).replace(/\n/g, '\n  ')}
}
`
}

const isCheck = process.argv.includes('--check')
const generated = generate()

if (isCheck) {
  let committed
  try {
    committed = readFileSync(outputPath, 'utf8')
  }
  catch {
    committed = null
  }
  if (committed !== generated) {
    console.error(
      'compatibility.json is out of date. Run `node scripts/generate-compatibility.mjs` and commit the result.',
    )
    process.exit(1)
  }
  console.log('compatibility.json is up to date.')
}
else {
  writeFileSync(outputPath, generated)
  console.log(`Wrote ${outputPath}`)
}
