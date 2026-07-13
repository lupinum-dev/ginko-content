import {
  createAgentMarkdownRegistry,
  type AgentMarkdownComponent,
  type AgentMarkdownComponentMap,
  type AgentMarkdownRegistry,
  type AgentMarkdownSerializer,
  type AgentMarkdownSerializerMap,
  type AgentMarkdownSerializerRegistrationOptions
} from '../../features/agent/agent-markdown'

const appRegistry: AgentMarkdownRegistry = createAgentMarkdownRegistry()

export const getAgentMarkdownRegistry = (): AgentMarkdownRegistry => appRegistry
export const registerAgentMarkdownSerializer = (
  name: string,
  serializer: AgentMarkdownSerializer,
  options?: AgentMarkdownSerializerRegistrationOptions
) => appRegistry.register(name, serializer, options)
export const registerAgentMarkdownSerializers = (
  entries: AgentMarkdownSerializerMap,
  options?: AgentMarkdownSerializerRegistrationOptions
) => appRegistry.registerMany(entries, options)
export const registerAgentMarkdownComponent = (
  name: string,
  component: AgentMarkdownComponent,
  options?: AgentMarkdownSerializerRegistrationOptions
) => appRegistry.registerComponent(name, component, options)
export const registerAgentMarkdownComponents = (
  entries: AgentMarkdownComponentMap,
  options?: AgentMarkdownSerializerRegistrationOptions
) => appRegistry.registerComponents(entries, options)
export const clearAgentMarkdownSerializers = () => appRegistry.clear()
