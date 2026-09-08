#!/usr/bin/env node
import { formatDoctorResult, runDoctor } from './cli/doctor'
import { formatContentValidationResult, runContentValidation } from './cli/validate'
import {
  assessFilesystemPortability,
  exportFilesystemToPortableDirectory,
  FilesystemPortabilityAssessmentError,
} from './portability-node/filesystem-export'

const [, , command, ...args] = process.argv

if (!command || command === '--help' || command === '-h') {
  console.log([
    'Usage: ginko-content <command> [options] [root]',
    '',
    'Commands:',
    '  doctor [root]         Validate a Nuxt Content v3 to Ginko migration',
    '  doctor --i18n [root]  Validate i18n migration wiring and generated output',
    '  validate [root]       Validate internal content links, anchors, and assets',
    '  portable assess [root]',
    '                        Assess filesystem content for portable V1 export',
    '  portable export <destination> [root]',
    '                        Export filesystem content to a new portable V1 directory'
  ].join('\n'))
  process.exit(0)
}

if (command !== 'doctor' && command !== 'validate' && command !== 'portable') {
  console.error(`Unknown command: ${command}`)
  console.error('Run "ginko-content --help" for available commands.')
  process.exit(1)
}

try {
  if (command === 'portable') {
    const [operation, ...portableArgs] = args
    const unknownFlag = portableArgs.find(arg => arg.startsWith('-'))
    if (unknownFlag || (operation !== 'assess' && operation !== 'export')) {
      console.error(unknownFlag ? `Unknown option: ${unknownFlag}` : 'Usage: ginko-content portable assess [root] | portable export <destination> [root]')
      process.exit(1)
    }
    if (operation === 'assess') {
      const result = await assessFilesystemPortability({ rootDir: portableArgs[0] || process.cwd() })
      for (const item of result.diagnostics) console.error(`${item.severity.toUpperCase()} ${item.code}${item.file ? ` ${item.file}` : ''}${item.field ? `:${item.field}` : ''}: ${item.message} ${item.resolution}`)
      if (result.evidence) console.log(`Filesystem portability ${result.ok ? 'passed' : 'failed'}: ${result.summary.documents} document(s), ${result.summary.assets} managed asset(s), input ${result.evidence.inputHash}.`)
      process.exit(result.ok ? 0 : 2)
    }
    if (!portableArgs[0]) {
      console.error('Usage: ginko-content portable export <destination> [root]')
      process.exit(1)
    }
    const result = await exportFilesystemToPortableDirectory({
      destination: portableArgs[0],
      rootDir: portableArgs[1] || process.cwd(),
    })
    console.log(`Portable V1 written to ${result.directory}: ${result.documents} document(s), ${result.assets} managed asset(s), manifest ${result.manifestSha256}.`)
    process.exit(0)
  }

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
  if (error instanceof FilesystemPortabilityAssessmentError) {
    for (const item of error.assessment.diagnostics) console.error(`${item.severity.toUpperCase()} ${item.code}${item.file ? ` ${item.file}` : ''}${item.field ? `:${item.field}` : ''}: ${item.message} ${item.resolution}`)
    process.exit(2)
  }
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
