import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  assertGeneratedLinkIntegrity,
  collectGeneratedLinkFailures,
  generatedFileCandidates
} from '../../../scripts/docs/generated-link-integrity.mjs'

const tempRoots: string[] = []

async function createOutput (files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'ginko-link-integrity-'))
  tempRoots.push(root)
  for (const [path, contents] of Object.entries(files)) {
    const absolute = resolve(root, path)
    await mkdir(resolve(absolute, '..'), { recursive: true })
    await writeFile(absolute, contents)
  }
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('generated link integrity', () => {
  test('normalizes route-shaped generated file candidates', () => {
    expect(generatedFileCandidates('/')).toContain('index.html')
    expect(generatedFileCandidates('/guide/start')).toEqual(expect.arrayContaining([
      'guide/start.html',
      'guide/start/index.html'
    ]))
  })

  test('accepts root-relative, document-relative, asset, and fragment references', async () => {
    const root = await createOutput({
      'index.html': '<a href="/guide/start#deep">Start</a><script src="/_nuxt/app.js"></script>',
      'guide/index.html': '<a href="start">Start</a>',
      'guide/start/index.html': '<h2 id="deep">Deep</h2>',
      '_nuxt/app.js': 'export {}'
    })

    await expect(assertGeneratedLinkIntegrity(root)).resolves.toBeUndefined()
    await expect(assertGeneratedLinkIntegrity(relative(process.cwd(), root))).resolves.toBeUndefined()
  })

  test('reports the source, original reference, missing file, and missing fragment', async () => {
    const root = await createOutput({
      'index.html': '<a href="/missing">Missing</a><a href="/guide#absent">Fragment</a>',
      'guide/index.html': '<h1 id="present">Guide</h1>'
    })

    const failures = await collectGeneratedLinkFailures(root)
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceFile: 'index.html', reference: '/missing' }),
      expect.objectContaining({ sourceFile: 'index.html', reference: '/guide#absent', reason: expect.stringContaining('missing fragment') })
    ]))
  })
})
