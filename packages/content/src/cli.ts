#!/usr/bin/env node
import { formatDoctorResult, runDoctor } from './cli/doctor'
import { formatContentValidationResult, runContentValidation } from './cli/validate'

const [, , command, ...args] = process.argv

if (!command || command === '--help' || command === '-h') {
  console.log([
    'Usage: ginko-content <command> [options] [root]',
    '',
    'Commands:',
    '  doctor [root]         Validate a Nuxt Content v3 to Ginko migration',
    '  doctor --i18n [root]  Validate i18n migration wiring and generated output',
    '  validate [root]       Validate internal content links, anchors, and assets'
  ].join('\n'))
  process.exit(0)
}

if (command !== 'doctor' && command !== 'validate') {
  console.error(`Unknown command: ${command}`)
  console.error('Run "ginko-content --help" for available commands.')
  process.exit(1)
}

try {
  if (command === 'validate') {
    const unknownFlag = args.find(arg => arg.startsWith('-'))
    if (unknownFlag) {
      console.error(`Unknown option: ${unknownFlag}`)
      process.exit(1)
    }
    const result = await runContentValidation({ rootDir: args[0] || process.cwd() })
    process.stdout.write(formatContentValidationResult(result))
    process.exit(result.exitCode)
  }

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
