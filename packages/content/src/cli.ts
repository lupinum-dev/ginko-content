#!/usr/bin/env node
import { formatDoctorResult, runDoctor } from './cli/doctor'

const [, , command, ...args] = process.argv

if (!command || command === '--help' || command === '-h') {
  console.log([
    'Usage: ginko-content <command> [options] [root]',
    '',
    'Commands:',
    '  doctor [root]         Validate a Nuxt Content v3 to Ginko migration',
    '  doctor --i18n [root]  Validate i18n migration wiring and generated output'
  ].join('\n'))
  process.exit(0)
}

if (command !== 'doctor') {
  console.error(`Unknown command: ${command}`)
  console.error('Run "ginko-content --help" for available commands.')
  process.exit(1)
}

try {
  const i18n = args.includes('--i18n')
  const rootDirArg = args.find(arg => !arg.startsWith('-'))
  const unknownFlag = args.find(arg => arg.startsWith('-') && arg !== '--i18n')

  if (unknownFlag) {
    console.error(`Unknown option: ${unknownFlag}`)
    console.error('Run "ginko-content --help" for available commands.')
    process.exit(1)
  }

  const result = await runDoctor({ rootDir: rootDirArg || process.cwd(), i18n })
  process.stdout.write(formatDoctorResult(result))
  process.exit(result.exitCode)
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
