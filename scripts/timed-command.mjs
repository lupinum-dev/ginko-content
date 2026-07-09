import { appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const [label, command, ...args] = process.argv.slice(2)
if (!label || !command) {
  console.error('Usage: node scripts/timed-command.mjs <label> <command> [...args]')
  process.exit(2)
}

const started = Date.now()
const result = spawnSync(command, args, {
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
const durationMs = Date.now() - started
const status = result.status ?? 1
const duration = `${(durationMs / 1000).toFixed(1)}s`
const commandText = [command, ...args].join(' ')

console.log(`[timing] ${label}: ${status === 0 ? 'PASS' : 'FAIL'} in ${duration}`)
if (process.env.GITHUB_STEP_SUMMARY) {
  const escapedCommand = commandText.replaceAll('|', '\\|')
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `| ${label} | ${status === 0 ? 'PASS' : `FAIL (${status})`} | ${duration} | \`${escapedCommand}\` |\n`
  )
}

if (result.signal) console.error(`${label} terminated by signal ${result.signal}`)
process.exit(status)
