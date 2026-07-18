/** Pure serializer registration surface for Nitro plugins and integrations. */
export {
  clearAgentMarkdownSerializers,
  getAgentMarkdownRegistry,
  registerAgentMarkdownComponent,
  registerAgentMarkdownComponents,
  registerAgentMarkdownSerializer,
  registerAgentMarkdownSerializers
} from '../runtime/server/agent-registry.js'
export {
  blockquoteMarkdown,
  createAgentMarkdownRegistry,
  defineAgentMarkdownComponent,
  getMarkdownProp,
  jsonFenceMarkdown,
  linkMarkdown,
  renderMarkdownChildren,
  xmlComponentMarkdown
} from '../features/agent/agent-markdown.js'
export type {
  AgentMarkdownComponent,
  AgentMarkdownComponentMap,
  AgentMarkdownContext,
  AgentMarkdownRegistry,
  AgentMarkdownSerializer,
  AgentMarkdownSerializerMap
} from '../features/agent/agent-markdown.js'
