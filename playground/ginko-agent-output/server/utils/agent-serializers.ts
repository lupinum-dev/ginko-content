import {
  blockquoteMarkdown,
  defineAgentMarkdownComponent,
  getMarkdownProp,
  registerAgentMarkdownComponents,
  registerAgentMarkdownSerializers,
  type AgentMarkdownSerializer
} from '@lupinum/ginko-content/server'

let registered = false

const renderCallout: AgentMarkdownSerializer = (node, ctx) => {
  const title = getMarkdownProp(node, 'title') || 'Callout'
  const body = ctx.renderChildren(node)
  return blockquoteMarkdown(`Fixture callout: ${title}\n\n${body}`)
}

const renderCard: AgentMarkdownSerializer = (node, ctx) =>
  ctx.xmlComponent('card', ctx.cleanProps(node), ctx.renderChildren(node))

const renderGallery: AgentMarkdownSerializer = (node, ctx) =>
  ctx.xmlComponent('gallery', ctx.cleanProps(node), ctx.renderChildren(node))

const renderConsentEmbed: AgentMarkdownSerializer = (node, ctx) => {
  const category = getMarkdownProp(node, 'category') || 'embeds'
  return blockquoteMarkdown(`Consent-gated embed. Category: ${category}.\n\n${ctx.renderChildren(node)}`)
}

const renderChart = defineAgentMarkdownComponent({
  render: (_node, ctx) => ctx.xmlComponent('chart', {}, ctx.jsonFence({
    source: 'fixture',
    values: [3, 5, 8]
  }))
})

export function registerFixtureAgentMarkdownSerializers () {
  if (registered) return
  registered = true

  registerAgentMarkdownComponents({
    chart: renderChart,
    MdcChart: renderChart
  })

  registerAgentMarkdownSerializers({
    callout: renderCallout,
    MdcCallout: renderCallout,
    card: renderCard,
    MdcCard: renderCard,
    gallery: renderGallery,
    MdcGallery: renderGallery,
    'consent-embed': renderConsentEmbed,
    ConsentEmbed: renderConsentEmbed
  })
}
