import transformer from '../examples/advanced/transformer/my-module/my-transformer'
import { describe, expect, test } from 'vitest'

describe('Custom transformer example', () => {
  test('parses custom file extensions through registered transformers', () => {
    const parsed = transformer.parse?.('content:1.index.names', 'John\nJoes\nJessi\nJason')

    expect(parsed).toMatchObject({
      id: 'content:1.index.names',
      type: 'json',
      body: ['Jason', 'Jessi', 'Joes', 'John']
    })
  })
})
