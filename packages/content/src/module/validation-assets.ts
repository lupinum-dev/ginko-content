import { isAbsolute, resolve } from 'node:path'
import { globby } from 'globby'

interface ValidationAssetOptions {
  rootDir: string
  publicDirectories: string[]
  nitroPublicAssets: Array<{ dir: string, baseURL?: string }>
}

const publicPath = (baseURL: string, file: string) => {
  const base = `/${baseURL}`.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return `${base === '' ? '' : base}/${file.replace(/\\/g, '/')}`.replace(/\/{2,}/g, '/')
}

/** Collect every root-relative URL backed by Nuxt or Nitro public directories. */
export const collectContentValidationPublicAssets = async (
  options: ValidationAssetOptions
): Promise<string[]> => {
  const assets = new Set<string>()
  const addDirectory = async (directory: string, baseURL: string) => {
    for (const file of await globby('**/*', { cwd: directory, onlyFiles: true })) {
      assets.add(publicPath(baseURL, file))
    }
  }

  for (const directory of options.publicDirectories) {
    await addDirectory(directory, '/')
  }
  for (const asset of options.nitroPublicAssets) {
    const directory = isAbsolute(asset.dir) ? asset.dir : resolve(options.rootDir, asset.dir)
    await addDirectory(directory, asset.baseURL || '/')
  }

  return [...assets].sort()
}
