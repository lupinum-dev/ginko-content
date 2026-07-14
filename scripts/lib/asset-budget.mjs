import { gzipSync } from 'node:zlib'

const attribute = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]
const assetName = (url) => {
  const match = url.match(/(?:^|\/)_nuxt\/([^?#]+)/)
  return match?.[1] && /\.(?:css|js)$/.test(match[1]) ? match[1] : undefined
}

export const collectReferencedAssets = (html) => {
  const assets = new Set()
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const asset = assetName(attribute(match[0], 'src') || '')
    if (asset) assets.add(asset)
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(match[0], 'rel') || '').toLowerCase().split(/\s+/)
    const as = (attribute(match[0], 'as') || '').toLowerCase()
    const relevant = rel.includes('stylesheet') || rel.includes('modulepreload')
      || (rel.includes('preload') && (as === 'script' || as === 'style'))
    if (!relevant) continue
    const asset = assetName(attribute(match[0], 'href') || '')
    if (asset) assets.add(asset)
  }
  return [...assets].sort()
}

export const measurePageAssetBudget = async (pages, readAsset) => {
  const compressed = new Map()
  const measure = async (asset) => {
    if (!compressed.has(asset)) compressed.set(asset, gzipSync(await readAsset(asset)).byteLength)
    return compressed.get(asset)
  }
  const measuredPages = await Promise.all(pages.map(async page => {
    const assets = collectReferencedAssets(page.html)
    const gzipBytes = (await Promise.all(assets.map(measure))).reduce((total, bytes) => total + bytes, 0)
    return { path: page.path, assets, gzipBytes }
  }))
  const maxPage = measuredPages.sort((left, right) => right.gzipBytes - left.gzipBytes)[0]
    || { path: '', assets: [], gzipBytes: 0 }
  const largest = [...compressed.entries()].sort((left, right) => right[1] - left[1])[0]
  return {
    maxPage,
    largestAsset: largest ? { asset: largest[0], gzipBytes: largest[1] } : { asset: '', gzipBytes: 0 }
  }
}
