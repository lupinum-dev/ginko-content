import { defineTransformer } from '@lupinum/ginko-content/transformers'

export default defineTransformer({
  name: 'my-transformer',
  extensions: ['.names'],
  parse (id: string, rawContent: string) {
    return {
      id,
      type: 'json',
      body: rawContent.trim().split('\n').map(line => line.trim()).sort()
    }
  }
})
