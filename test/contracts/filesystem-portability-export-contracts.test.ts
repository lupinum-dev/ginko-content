import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildResolvedContentContract } from '../../packages/content/src/cms-contract/build'
import { writeResolvedContentContractArtifact } from '../../packages/content/src/cms-contract-node/artifact'
import {
  assessFilesystemPortability,
  exportFilesystemToPortableDirectory,
} from '../../packages/content/src/portability-node/filesystem-export'
import { readPortableDirectory } from '../../packages/content/src/portability-node/read-directory'
import { PORTABILITY_CONTRACT_FIXTURES } from '../../packages/content/src/testing/portability-contract'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('filesystem portability export', () => {
  it('assesses source directly and exports a deterministic multilingual tree', async () => {
    const root = await fixture()
    const first = await assessFilesystemPortability({ rootDir: root })
    expect(first.diagnostics).toEqual([])
    expect(first).toMatchObject({
      ok: true,
      summary: { documents: 4, assets: 1, collections: ['authors', 'docs'], locales: ['en', 'fr'] },
    })
    expect(first.documents.find(item => item.collection === 'docs' && item.locale === 'fr')).toMatchObject({
      canonicalKey: '1', slug: 'commencer', parentCanonicalKey: null,
      localized: { title: 'Commencer', icon: 'book', sidebar: 'section', author: { collection: 'authors', canonicalKey: 'authors/1' } },
      visibility: { navigation: true, search: false, sitemap: true },
    })

    const one = join(root, 'portable-one')
    const two = join(root, 'portable-two')
    const exported = await exportFilesystemToPortableDirectory({ rootDir: root, destination: one, expectedInputHash: first.evidence!.inputHash })
    await exportFilesystemToPortableDirectory({ rootDir: root, destination: two })
    expect(await readFile(join(one, '.ginko/portable.json'))).toEqual(await readFile(join(two, '.ginko/portable.json')))
    await expect(readPortableDirectory(one)).resolves.toMatchObject({ documents: expect.arrayContaining([expect.objectContaining({ document: expect.objectContaining({ canonicalKey: '1' }) })]) })
    expect(await readFile(join(one, `public/ginko-assets/${PORTABILITY_CONTRACT_FIXTURES.png.sha256}.png`))).toEqual(Buffer.from(PORTABILITY_CONTRACT_FIXTURES.png.bytes))
    expect(exported).toMatchObject({ documents: 4, assets: 1, inputHash: first.evidence!.inputHash })
  })

  it('refuses stale assessment evidence and leaves an existing destination untouched', async () => {
    const root = await fixture()
    const assessed = await assessFilesystemPortability({ rootDir: root })
    await writeFile(join(root, 'content/fr/1.guide/1.commencer/index.md'), '---\ntitle: Modifié\n---\nChanged.\n')
    await expect(exportFilesystemToPortableDirectory({ rootDir: root, destination: 'portable', expectedInputHash: assessed.evidence!.inputHash })).rejects.toMatchObject({ code: 'CONTRACT_HASH_MISMATCH' })
    await mkdir(join(root, 'existing'))
    await writeFile(join(root, 'existing/keep.txt'), 'keep')
    await expect(exportFilesystemToPortableDirectory({ rootDir: root, destination: 'existing' })).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' })
    await expect(readFile(join(root, 'existing/keep.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('reports stale contracts and missing managed assets without writing partial output', async () => {
    const root = await fixture()
    const configPath = join(root, 'content.config.mjs')
    const originalConfig = await readFile(configPath, 'utf8')
    const originalContract = await readFile(join(root, '.ginko/content-contract.json'))
    await writeFile(configPath, originalConfig.replace('"group"]', '"group","aside"]'))
    const stale = await assessFilesystemPortability({ rootDir: root })
    expect(stale.diagnostics).toContainEqual(expect.objectContaining({
      code: 'CONTRACT_HASH_MISMATCH', file: '.ginko/content-contract.json', severity: 'error',
    }))

    await writeFile(configPath, originalConfig)
    await writeFile(join(root, '.ginko/content-contract.json'), originalContract)
    await rm(join(root, `public/ginko-assets/${PORTABILITY_CONTRACT_FIXTURES.png.sha256}.png`))
    const missing = await assessFilesystemPortability({ rootDir: root })
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({
      code: 'ASSET_INTEGRITY_FAILED',
      file: `public/ginko-assets/${PORTABILITY_CONTRACT_FIXTURES.png.sha256}.png`,
      collection: 'docs',
    }))
    await expect(exportFilesystemToPortableDirectory({ rootDir: root, destination: 'partial' })).rejects.toBeInstanceOf(Error)
    await expect(readFile(join(root, 'partial/.ginko/portable.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ginko-filesystem-portable-'))
  roots.push(root)
  const collection = {
    type: 'page' as const,
    source: '{1.guide,1.docs}/**/*.md',
    i18n: true as const,
    route: { fr: '/guide', en: '/docs' },
    sitemap: true,
    cms: {
      type: 'tree' as const,
      route: { allowMultipleRoots: true },
      fields: {
        icon: { type: 'text' as const, localized: true },
        sidebar: { type: 'select' as const, localized: true, options: ['section', 'group'] },
        hero: { type: 'image' as const, localized: true },
        author: { type: 'relation' as const, localized: true, relation: { collectionId: 'authors' } },
      },
    },
  }
  const authors = {
    type: 'data' as const,
    source: 'authors/*.json',
    i18n: true as const,
    sitemap: false,
    cms: { fields: { name: { type: 'text' as const, localized: true, required: true } } },
  }
  const resolvedCollections = {
    docs: { ...collection, i18n: { defaultLocale: 'fr', locales: ['fr', 'en'] } },
    authors: { ...authors, i18n: { defaultLocale: 'fr', locales: ['fr', 'en'] } },
  }
  await mkdir(join(root, '.ginko'), { recursive: true })
  await mkdir(join(root, 'content/fr/1.guide/1.commencer'), { recursive: true })
  await mkdir(join(root, 'content/en/1.docs/1.start'), { recursive: true })
  await mkdir(join(root, 'content/fr/authors'), { recursive: true })
  await mkdir(join(root, 'content/en/authors'), { recursive: true })
  await mkdir(join(root, 'public/ginko-assets'), { recursive: true })
  await mkdir(join(root, 'node_modules/@lupinum/ginko-content'), { recursive: true })
  await writeFile(join(root, 'content.config.mjs'), `export default ${JSON.stringify({ provider: 'filesystem', collections: resolvedCollections })}\n`)
  await writeFile(join(root, 'nuxt.config.mjs'), `export default ${JSON.stringify({ content: { i18n: { locales: ['fr', 'en'], defaultLocale: 'fr', fallback: { fr: [], en: ['fr'] }, translatedSlugs: true }, search: false, sitemap: true }, modules: [] })}\n`)
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(root, 'node_modules/@lupinum/ginko-content/package.json'), '{"version":"1.0.0-test"}\n')
  await writeFile(join(root, 'content/fr/1.guide/1.commencer/index.md'), `---\ntitle: Commencer\nauthor: authors/1\nhero:\n  kind: local\n  path: /ginko-assets/${PORTABILITY_CONTRACT_FIXTURES.png.sha256}.png\n  sha256: ${PORTABILITY_CONTRACT_FIXTURES.png.sha256}\n  bytes: ${PORTABILITY_CONTRACT_FIXTURES.png.bytes.byteLength}\n  mediaType: image/png\n  originalFilename: feuille.png\n---\n[Docs]($docs/start)\n\n![Static](/images/logo.png)\n`)
  await writeFile(join(root, 'content/en/1.docs/1.start/index.md'), '---\ntitle: Start\nauthor: authors/1\nhero: https://images.example.test/hero.png\n---\n[Guide]($docs/commencer)\n')
  await writeFile(join(root, 'content/fr/1.guide/1.commencer/.navigation.yml'), 'title: Commencer\nicon: book\nsidebar: section\n')
  await writeFile(join(root, 'content/en/1.docs/1.start/.navigation.yml'), 'title: Start\nicon: book\nsidebar: group\n')
  await writeFile(join(root, 'content/fr/authors/1.ada.json'), '{"name":"Ada FR"}\n')
  await writeFile(join(root, 'content/en/authors/1.ada.json'), '{"name":"Ada EN"}\n')
  await writeFile(join(root, `public/ginko-assets/${PORTABILITY_CONTRACT_FIXTURES.png.sha256}.png`), PORTABILITY_CONTRACT_FIXTURES.png.bytes)
  await fixtureContract(root)
  return root
}

async function fixtureContract(root: string) {
  const config = (await import(`${join(root, 'content.config.mjs')}?t=${Date.now()}-${Math.random()}`)).default
  const contract = buildResolvedContentContract({ collections: config.collections }, {
    defaultLocale: 'fr', locales: ['fr', 'en'], localeFallbacks: { fr: [], en: ['fr'] }, translatedSlugs: true,
  })
  await writeResolvedContentContractArtifact(root, contract)
}
