import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { collectContentValidationPublicAssets } from '../../packages/content/src/module/validation-assets'

describe('content validation public assets', () => {
  test('includes custom Nitro publicAssets under their configured baseURL', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'ginko-validation-assets-'))
    const publicDir = join(rootDir, 'public')
    const mediaDir = join(rootDir, 'shared-media')
    try {
      await mkdir(publicDir, { recursive: true })
      await mkdir(mediaDir, { recursive: true })
      await writeFile(join(publicDir, 'favicon.svg'), '<svg/>')
      await writeFile(join(mediaDir, 'hero wide.png'), 'image')

      await expect(collectContentValidationPublicAssets({
        rootDir,
        layers: [{ cwd: rootDir, publicDir: 'public' }],
        nitroPublicAssets: [{ dir: 'shared-media', baseURL: '/media/' }]
      })).resolves.toEqual(['/favicon.svg', '/media/hero wide.png'])
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
