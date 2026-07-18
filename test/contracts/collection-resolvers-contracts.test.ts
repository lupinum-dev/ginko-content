import { describe, expect, test } from 'vitest'
import { resolveCollection } from '../../packages/content/src/core/content/collection'

describe('collection resolution contracts', () => {
  test('collection sources with numeric prefixes match translated slug filenames', () => {
    const collections = {
      docs: { source: '1.docs/**/*' },
      pricing: { source: '2.pricing.yml' },
      versions: { source: '4.changelog/**/*' }
    }

    expect(resolveCollection('de/1.dokumentation/1.erste-schritte/1.index.md', collections, ['en', 'de'])).toBe('docs')
    expect(resolveCollection('de/2.preise.yml', collections, ['en', 'de'])).toBe('pricing')
    expect(resolveCollection('de/4.aenderungen/1.launch.md', collections, ['en', 'de'])).toBe('versions')
  })

  test('does not resolve excluded collection files', () => {
    const collections = {
      docs: {
        source: 'docs/**/*.md',
        exclude: 'docs/private/**'
      }
    }

    expect(resolveCollection('docs/getting-started.md', collections)).toBe('docs')
    expect(resolveCollection('docs/private/internal.md', collections)).toBeUndefined()
  })
})
