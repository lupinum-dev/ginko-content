import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { assertNoRepeatedLocalePrefixes } from '../helpers/generated-artifacts'
import { readSitemapBundle } from '../helpers/sitemap-artifacts'

describe('generated artifact helpers', () => {
  test('fails when a sitemap index has no child sitemaps', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'ginko-sitemap-empty-index-'))
    await writeFile(join(publicDir, 'sitemap_index.xml'), '<sitemapindex />')

    await expect(readSitemapBundle(publicDir)).rejects.toThrow(
      'Sitemap index did not reference any child sitemaps'
    )
  })

  test('fails when a sitemap index points at a missing child sitemap', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'ginko-sitemap-missing-child-'))
    await writeFile(
      join(publicDir, 'sitemap_index.xml'),
      '<sitemapindex><sitemap><loc>https://example.test/__sitemap__/en-US.xml</loc></sitemap></sitemapindex>'
    )

    await expect(readSitemapBundle(publicDir)).rejects.toThrow(
      'Sitemap index references missing child sitemap: __sitemap__/en-US.xml'
    )
  })

  test('fails when a sitemap index points at an empty child sitemap', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'ginko-sitemap-empty-child-'))
    await writeFile(
      join(publicDir, 'sitemap_index.xml'),
      '<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>'
    )
    await writeFile(join(publicDir, 'child.xml'), '')

    await expect(readSitemapBundle(publicDir)).rejects.toThrow(
      'Sitemap index references empty child sitemap: child.xml'
    )
  })

  test('fails when a generated artifact contains repeated locale prefixes', () => {
    expect(() => assertNoRepeatedLocalePrefixes([
      {
        path: 'sitemap.xml',
        text: '<loc>https://example.test/de/de/leitfaden</loc>'
      }
    ], ['de', 'en'])).toThrow('sitemap.xml should not contain repeated locale prefixes')
  })
})
