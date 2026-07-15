/**
 * LLM markdown output public API surface (Nitro / H3 contexts).
 *
 * The "agent" feature serves agent-readable content output — `/raw/*.md`,
 * `/llms.txt`, `/llms-full.txt`, and the component→markdown serializers /
 * registration primitives. It lives on its own subpath (`@lupinum/ginko-content/agent`)
 * so it does not share the `./server` query facade. The `agent` code identifiers
 * match the shipped module option name (`agent: {...}`).
 *
 * This is a PURE re-export: the registration API was reshaped once (per-app
 * registry) in T4.2b — the moved names keep their call signatures.
 */
export {
  clearAgentMarkdownSerializers,
  blockquoteMarkdown,
  createAgentMarkdownRegistry,
  defineAgentMarkdownComponent,
  getMarkdownProp,
  jsonFenceMarkdown,
  linkMarkdown,
  registerAgentMarkdownComponent,
  registerAgentMarkdownComponents,
  registerAgentMarkdownSerializer,
  registerAgentMarkdownSerializers,
  renderMarkdownChildren,
  xmlComponentMarkdown
} from '../runtime/server/agent-markdown.js'
export {
  renderAgentMarkdownFrontmatter,
  renderAgentMarkdownPage,
  renderLlmsFullTxt,
  renderLlmsTxt
} from '../runtime/server/agent-site.js'
export {
  agentMarkdownPathForRoute,
  agentRawPathForRoute,
  normalizeAgentRoutePath
} from '../features/agent/agent-paths.js'
export type {
  AgentMarkdown,
  AgentMarkdownComponent,
  AgentMarkdownComponentMap,
  AgentMarkdownContext,
  AgentMarkdownMeta,
  AgentMarkdownPublicSignals,
  AgentMarkdownRegistry,
  AgentMarkdownSerializer,
  AgentMarkdownSerializerMap,
  ResolvedAgentMarkdownOptions
} from '../runtime/server/agent-markdown.js'
export type {
  AgentPage,
  AgentPageSource
} from '../runtime/server/agent-site.js'
