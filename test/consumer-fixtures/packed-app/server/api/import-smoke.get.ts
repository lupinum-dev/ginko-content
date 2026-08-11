import { one, many } from '@lupinum/ginko-content/server'
      import { createAgentMarkdownRegistry } from '@lupinum/ginko-content/agent'

      export default defineEventHandler(() => ({
        server: typeof one,
        many: typeof many,
        agentRegistry: typeof createAgentMarkdownRegistry
      }))
    
