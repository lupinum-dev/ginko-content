import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const config = JSON.parse(readFileSync(resolve(root, 'docs/vercel.json'), 'utf8'))
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

check(!existsSync(resolve(root, 'vercel.json')), 'Keep vercel.json in the deployable docs app.')
check(config.framework === 'nuxtjs', 'Select the Nuxt framework explicitly.')
check(config.outputDirectory === null, 'Let Nuxt and Vercel detect .vercel/output.')
check(config.buildCommand === 'pnpm --dir .. docs:build:vercel', 'Build the package before the docs app.')
check(!('installCommand' in config), 'Let Vercel detect pnpm from the repository lockfile.')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Vercel app-root contract: ok')
