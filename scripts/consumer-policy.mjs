import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { checkDependencyPolicy } from './check-dependency-policy.mjs'

// Generated installs inherit the maintained policy, including inline exception metadata.
export function prepareConsumerPolicy(directory, now = Date.now()) {
  const document = parseDocument(readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
  document.set('packages', [])
  document.set('linkWorkspacePackages', false)
  // Probe the published dependency graph and requested compatibility versions.
  // Workspace-only resolutions must not override those selections.
  document.delete('overrides')
  document.delete('packageExtensions')
  const path = resolve(directory, 'pnpm-workspace.yaml')
  writeFileSync(path, document.toString())
  const failures = checkDependencyPolicy(readFileSync(path, 'utf8'), now)
  if (failures.length) throw new Error(failures.join('\n'))
  // npm's cutoff enforces the same age without translating exact exceptions
  // into npm's broader package-name exemptions. It also works on older npm.
  return `--before=${new Date(now - document.get('minimumReleaseAge') * 60_000).toISOString()}`
}
