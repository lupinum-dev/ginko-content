import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DoctorFinding } from '../types'
import { toRelativePath } from '../files'
import { lockfileNames, stalePackageNames } from './constants'

function packageDependencyFindings(rootDir: string, packageJson: Record<string, any>): DoctorFinding[] {
  const dependencyBlocks = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
  const findings: DoctorFinding[] = []

  for (const blockName of dependencyBlocks) {
    const block = packageJson[blockName]
    if (!block || typeof block !== 'object') {
      continue
    }

    for (const packageName of stalePackageNames) {
      if (packageName in block) {
        findings.push({
          severity: 'error',
          file: toRelativePath(rootDir, join(rootDir, 'package.json')),
          message: `Direct dependency "${packageName}" found in ${blockName}.`,
          suggestion: packageName === '@nuxt/content'
            ? 'Remove @nuxt/content and install @lupinum/ginko-content.'
            : `Remove ${packageName} unless the app imports it directly. If it is only transitive, keep it out of package.json.`
        })
      }
    }
  }

  return findings
}

async function inspectPackageJson(rootDir: string): Promise<DoctorFinding[]> {
  const path = join(rootDir, 'package.json')
  if (!existsSync(path)) {
    return []
  }

  try {
    const packageJson = JSON.parse(await readFile(path, 'utf8')) as Record<string, any>
    return packageDependencyFindings(rootDir, packageJson)
  }
  catch {
    return [{
      severity: 'error',
      file: 'package.json',
      message: 'package.json could not be parsed.',
      suggestion: 'Fix package.json before running ginko-content doctor again.'
    }]
  }
}

async function inspectLockfiles(rootDir: string): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = []

  for (const lockfileName of lockfileNames) {
    const path = join(rootDir, lockfileName)
    if (!existsSync(path)) {
      continue
    }

    const text = await readFile(path, 'utf8')
    const presentPackages = stalePackageNames.filter(packageName => text.includes(packageName))
    if (presentPackages.length) {
      findings.push({
        severity: 'info',
        file: lockfileName,
        message: `Lockfile still mentions ${presentPackages.join(', ')}.`,
        suggestion: `Run "pnpm why ${presentPackages.join(' ')}" and only act if one is still a direct app dependency.`
      })
    }
  }

  return findings
}

export async function inspectDependencies(rootDir: string): Promise<DoctorFinding[]> {
  return [
    ...await inspectPackageJson(rootDir),
    ...await inspectLockfiles(rootDir)
  ]
}
