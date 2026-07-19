import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const artifactPath = resolve(root, '.pack/release-artifact.json')
if (!existsSync(artifactPath)) {
  throw new Error('Run release:pack before writing release certification.')
}

const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
const readLane = (name) => {
  const path = resolve(root, `.pack/release-lane-${name}.json`)
  if (!existsSync(path)) {
    throw new Error(`Release lane evidence is missing for ${name}.`)
  }
  const lane = JSON.parse(readFileSync(path, 'utf8'))
  if (lane.status !== 'passed' || lane.sha256 !== artifact.sha256) {
    throw new Error(`Release lane evidence for ${name} does not match the exact tarball.`)
  }
  return lane
}
const pureRuntimes = readLane('pure-runtimes')
const packedConsumerPnpm = readLane('consumer-pnpm')
const packedConsumerNpm = readLane('consumer-npm')
const version = command => execFileSync(command, ['--version'], {
  cwd: root,
  encoding: 'utf8',
}).trim()

const certification = {
  schemaVersion: 1,
  packageName: artifact.packageName,
  packageVersion: artifact.packageVersion,
  commit: artifact.commit,
  tarball: artifact.tarball,
  sha256: artifact.sha256,
  runtime: {
    node: process.version,
    releaseRunner: {
      pnpm: version('pnpm'),
      npm: version('npm'),
    },
    lanes: {
      pureRuntimes: { node: pureRuntimes.node, runtimes: pureRuntimes.runtimes },
      packedConsumerPnpm: {
        node: packedConsumerPnpm.node,
        packageManager: packedConsumerPnpm.packageManager,
        packageManagerVersion: packedConsumerPnpm.packageManagerVersion,
      },
      packedConsumerNpm: {
        node: packedConsumerNpm.node,
        packageManager: packedConsumerNpm.packageManager,
        packageManagerVersion: packedConsumerNpm.packageManagerVersion,
      },
    },
  },
  lanes: {
    pureRuntimes: 'passed',
    packedConsumerPnpm: 'passed',
    packedConsumerNpm: 'passed',
  },
  fixture: {
    seed: 'packed-memory-v1',
    documents: 2,
    locales: 1,
    collections: 1,
    routes: 2,
    maximumTreeDepth: 1,
  },
}

writeFileSync(
  resolve(root, '.pack/release-certification.json'),
  `${JSON.stringify(certification, null, 2)}\n`,
)
