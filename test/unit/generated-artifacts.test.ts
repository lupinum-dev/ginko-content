import { describe, expect, test } from 'vitest'
import {
  assertNoLocalOrigins,
  assertNoPrivateContentLeaks,
  assertNoRepeatedLocalePrefixes
} from '../helpers/generated-artifacts'

describe('generated artifact negative-check controls', () => {
  test('local-origin detector rejects localhost output', () => {
    expect(() => assertNoLocalOrigins([
      { path: 'index.html', text: '<a href="http://localhost:3000/private">local</a>' }
    ])).toThrow()
  })

  test('locale-prefix detector rejects repeated locale segments', () => {
    expect(() => assertNoRepeatedLocalePrefixes([
      { path: 'index.html', text: '<a href="/de/en/guide">bad locale path</a>' }
    ], ['de', 'en'])).toThrow()
  })

  test('private-content detector rejects fixture sentinel text', () => {
    expect(() => assertNoPrivateContentLeaks([
      { path: 'search.json', text: '{"title":"Draft Roadmap"}' }
    ], ['Draft Roadmap'])).toThrow()
  })
})
