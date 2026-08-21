import { describe, expect, test } from 'vitest'
import {
  buildMarkdownFeatureDiagnostics,
  detectMarkdownFeatureUsage,
  emptyMarkdownFeatureUsage,
  recordMarkdownFeatureUsage
} from '../../packages/content/src/core/markdown/feature-detect'

describe('detectMarkdownFeatureUsage', () => {
  test('detects $$ block math', () => {
    expect(detectMarkdownFeatureUsage('Euler: $$e^{i\\pi} + 1 = 0$$')).toMatchObject({ math: true })
    expect(detectMarkdownFeatureUsage('Cost: $5 and $6')).toMatchObject({ math: false })
    expect(detectMarkdownFeatureUsage('# Plain')).toMatchObject({ math: false })
  })

  test('detects mermaid fences', () => {
    expect(detectMarkdownFeatureUsage('```mermaid\ngraph TD\nA-->B\n```')).toMatchObject({ mermaid: true })
    expect(detectMarkdownFeatureUsage('indented:\n  ```mermaid\n  A-->B\n  ```')).toMatchObject({ mermaid: true })
    expect(detectMarkdownFeatureUsage('```ts\nconst a = 1\n```')).toMatchObject({ mermaid: false })
  })

  test('records usage per file with a bounded list', () => {
    const usage = emptyMarkdownFeatureUsage()
    for (let index = 0; index < 60; index += 1) {
      recordMarkdownFeatureUsage(usage, `content/math-${index}.md`, { math: true, mermaid: index === 0 })
    }
    expect(usage.math).toHaveLength(50)
    expect(usage.mermaid).toHaveLength(1)
  })
})

describe('buildMarkdownFeatureDiagnostics', () => {
  test('warns once per feature when the plugin is not enabled', () => {
    const usage = emptyMarkdownFeatureUsage()
    recordMarkdownFeatureUsage(usage, 'docs/physics.md', { math: true, mermaid: true })

    const diagnostics = buildMarkdownFeatureDiagnostics(usage, ['shiki'])
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map(diagnostic => diagnostic.key)).toEqual([
      'markdown-math-plugin-not-enabled',
      'markdown-mermaid-plugin-not-enabled'
    ])
    expect(diagnostics[0]?.message).toContain('"docs/physics.md"')
    expect(diagnostics[0]?.message).toContain('Add "math" to markdown.plugins')
  })

  test('stays silent when the matching plugin is enabled', () => {
    const usage = emptyMarkdownFeatureUsage()
    recordMarkdownFeatureUsage(usage, 'docs/physics.md', { math: true, mermaid: true })

    expect(buildMarkdownFeatureDiagnostics(usage, [
      'shiki',
      ['math', {}],
      ['mermaid', {}]
    ])).toEqual([])
  })

  test('stays silent when nothing was detected and tolerates omitted plugins', () => {
    expect(buildMarkdownFeatureDiagnostics(emptyMarkdownFeatureUsage(), undefined)).toEqual([])
    const usage = emptyMarkdownFeatureUsage()
    recordMarkdownFeatureUsage(usage, 'a.md', { math: true, mermaid: false })
    expect(buildMarkdownFeatureDiagnostics(usage, undefined)).toHaveLength(1)
  })

  test('caps the listed example files but reports the true count', () => {
    const usage = emptyMarkdownFeatureUsage()
    for (let index = 0; index < 8; index += 1) {
      recordMarkdownFeatureUsage(usage, `m-${index}.md`, { math: true, mermaid: false })
    }
    const [diagnostic] = buildMarkdownFeatureDiagnostics(usage, [])
    expect(diagnostic?.message).toContain('8 documents')
    expect(diagnostic?.message).toContain('and 3 more')
  })
})
