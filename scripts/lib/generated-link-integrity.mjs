import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Window } from 'happy-dom'

const syntheticOrigin = 'https://generated-output.invalid'
const allowedNonHttpSchemes = new Set(['data:', 'mailto:', 'tel:', 'blob:'])

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.?\/+/, '')
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = resolve(directory, entry.name)
    return entry.isDirectory() ? listFiles(root, absolute) : [normalizePath(absolute.slice(root.length + 1))]
  }))
  return nested.flat()
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

export function generatedFileCandidates(pathname) {
  const raw = normalizePath(pathname)
  const decoded = normalizePath(decodePath(pathname))
  const paths = new Set([raw, decoded])
  const candidates = new Set()

  for (const path of paths) {
    if (!path) {
      candidates.add('index.html')
      continue
    }
    candidates.add(path)
    if (path.endsWith('/')) {
      candidates.add(`${path}index.html`)
    } else if (!/\.[^/]+$/.test(path)) {
      candidates.add(`${path}.html`)
      candidates.add(`${path}/index.html`)
    }
  }

  return [...candidates]
}

function extractReferences(document) {
  const references = []
  for (const element of document.querySelectorAll('[href], [src]')) {
    for (const attribute of ['href', 'src']) {
      if (!element.hasAttribute(attribute)) continue
      const value = element.getAttribute(attribute)?.trim()
      if (value) references.push(value)
    }
  }
  return references
}

function parseHtml(html, url) {
  const window = new Window({ url })
  window.document.write(html)
  return window.document
}

export async function collectGeneratedLinkFailures(publicDir) {
  const outputRoot = resolve(publicDir)
  const files = (await listFiles(outputRoot)).sort()
  const fileSet = new Set(files)
  const htmlFiles = files.filter(file => file.endsWith('.html'))
  const htmlCache = new Map()
  const failures = []

  const readHtmlDocument = async (file) => {
    if (!htmlCache.has(file)) {
      const html = await readFile(resolve(outputRoot, file), 'utf8')
      htmlCache.set(file, parseHtml(html, `${syntheticOrigin}/${file}`))
    }
    return htmlCache.get(file)
  }

  for (const sourceFile of htmlFiles) {
    const sourceDocument = await readHtmlDocument(sourceFile)
    for (const reference of extractReferences(sourceDocument)) {
      let target
      try {
        target = new URL(reference, `${syntheticOrigin}/${sourceFile}`)
      } catch {
        failures.push({ sourceFile, reference, reason: 'invalid URL' })
        continue
      }

      if (allowedNonHttpSchemes.has(target.protocol)) continue
      if (!['http:', 'https:'].includes(target.protocol)) {
        failures.push({ sourceFile, reference, reason: `unsupported scheme ${target.protocol}` })
        continue
      }
      if (target.origin !== syntheticOrigin) continue

      const candidates = generatedFileCandidates(target.pathname)
      const emittedFile = candidates.find(candidate => fileSet.has(candidate))
      if (!emittedFile) {
        failures.push({
          sourceFile,
          reference,
          reason: `no emitted file (tried ${candidates.join(', ')})`
        })
        continue
      }

      if (target.hash && emittedFile.endsWith('.html')) {
        const fragment = decodePath(target.hash.slice(1))
        if (fragment) {
          const targetDocument = await readHtmlDocument(emittedFile)
          const namedAnchor = [...targetDocument.getElementsByName(fragment)].length > 0
          if (!targetDocument.getElementById(fragment) && !namedAnchor) {
            failures.push({
              sourceFile,
              reference,
              reason: `missing fragment #${fragment} in ${emittedFile}`
            })
          }
        }
      }
    }
  }

  return failures
}

export async function assertGeneratedLinkIntegrity(publicDir) {
  const failures = await collectGeneratedLinkFailures(publicDir)
  if (failures.length === 0) return

  throw new Error(
    `Generated link integrity failed for ${publicDir}:\n` +
    failures.map(({ sourceFile, reference, reason }) => `  - ${sourceFile}: ${reference} -> ${reason}`).join('\n')
  )
}
