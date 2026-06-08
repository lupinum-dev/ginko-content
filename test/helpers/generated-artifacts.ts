import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect } from 'vitest'

export interface GeneratedTextArtifact {
  path: string
  text: string
}

const textArtifactPattern = /\.(?:html|xml|json|txt|md)$/
const localOriginPattern = /http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])|https?:\/\/[^/\s"'<>]*localhost/i

export async function readGeneratedArtifact (publicDir: string, relativePath: string) {
  return readFile(resolve(publicDir, relativePath), 'utf8')
}

export async function listGeneratedFiles (
  publicDir: string,
  directory = publicDir
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      return listGeneratedFiles(publicDir, path)
    }

    return [path.slice(publicDir.length + 1)]
  }))

  return files.flat()
}

export async function listGeneratedTextArtifacts (publicDir: string) {
  const files = await listGeneratedFiles(publicDir)
  const textFiles = files.filter(path => textArtifactPattern.test(path))
  return await Promise.all(textFiles.map(async path => ({
    path,
    text: await readGeneratedArtifact(publicDir, path)
  })))
}

export function assertNoLocalOrigins (artifacts: GeneratedTextArtifact[]) {
  for (const artifact of artifacts) {
    expect(artifact.text, `${artifact.path} should not leak local origins`).not.toMatch(localOriginPattern)
  }
}

export function assertNoRepeatedLocalePrefixes (
  artifacts: GeneratedTextArtifact[],
  locales: string[]
) {
  const escaped = locales.map(locale => locale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`/(?:${escaped})/(?:${escaped})(?:/|$)`)

  for (const artifact of artifacts) {
    expect(artifact.text, `${artifact.path} should not contain repeated locale prefixes`).not.toMatch(pattern)
  }
}

export function assertNoPrivateContentLeaks (
  artifacts: GeneratedTextArtifact[],
  forbiddenTerms: string[]
) {
  for (const artifact of artifacts) {
    for (const term of forbiddenTerms) {
      expect(artifact.text, `${artifact.path} should not leak "${term}"`).not.toContain(term)
    }
  }
}

export async function readSearchIndex (publicDir: string) {
  return JSON.parse(await readGeneratedArtifact(publicDir, 'api/_content/search/index.json')) as Array<Record<string, unknown>>
}

export async function readMarkdownPair (publicDir: string, routePath: string) {
  const normalized = routePath.replace(/^\/+|\/+$/g, '')
  const routeMarkdown = normalized ? `${normalized}/index.md` : 'index.md'
  const rawMarkdown = normalized ? `raw/${normalized}.md` : 'raw/index.md'

  return {
    route: await readGeneratedArtifact(publicDir, routeMarkdown),
    raw: await readGeneratedArtifact(publicDir, rawMarkdown)
  }
}
