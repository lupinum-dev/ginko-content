import { defineNitroPlugin } from 'nitropack/runtime'
import { registerFixtureAgentMarkdownSerializers } from '../utils/agent-serializers'

export default defineNitroPlugin(() => {
  registerFixtureAgentMarkdownSerializers()
})
