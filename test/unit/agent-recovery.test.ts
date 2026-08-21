import { describe, expect, test } from 'vitest'
import {
  renderAgentNotFoundMarkdown,
  shouldSkipAgentMarkdownPath
} from '../../packages/content/src/runtime/server/agent-http'

describe('agent markdown recovery', () => {
  test('points a missing public page back to discoverable content', () => {
    expect(renderAgentNotFoundMarkdown('/missing')).toBe(
      '# Page not found\n\n' +
      'No public page exists at `/missing`.\n\n' +
      '## Where to look next\n\n' +
      '- [Agent content index](/llms.txt)\n' +
      '- [Complete agent content](/llms-full.txt)\n' +
      '- [Homepage](/)\n'
    )
  })

  test('escapes backslashes before Markdown control characters', () => {
    expect(renderAgentNotFoundMarkdown('/missing\\`page')).toContain(
      'No public page exists at `/missing\\\\\\`page`.'
    )
  })

  test('does not replace API or asset errors with a Markdown document', () => {
    expect(shouldSkipAgentMarkdownPath('/api/example')).toBe(true)
    expect(shouldSkipAgentMarkdownPath('/image.png')).toBe(true)
    expect(shouldSkipAgentMarkdownPath('/missing-page')).toBe(false)
  })
})
