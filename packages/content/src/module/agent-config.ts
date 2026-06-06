import type { ContentConfig, ContentAgentSectionConfig } from '../types/config'
import type { ModuleOptions } from '../types/module'
import { normalizeAgentRouteOptions } from './agent-options'

export const hasAgentSurface = (config: ContentConfig) =>
  Boolean(
    config.agent
    || Object.values(config.collections || {}).some(collection => Boolean(collection.agent?.markdown))
  )

const agentSectionIds = (sections: readonly ContentAgentSectionConfig[] | undefined) =>
  new Set((sections || []).map(section => section.id).filter(Boolean))

export const validateAgentConfig = (
  config: ContentConfig,
  options: ModuleOptions,
  context: { dev: boolean }
) => {
  if (!hasAgentSurface(config)) return

  const agentRoutes = normalizeAgentRouteOptions(options)
  if (!context.dev && agentRoutes.routes && agentRoutes.prerender && !config.agent?.site?.url) {
    throw new Error(
      '@lupinum/ginko-content agent prerender requires agent.site.url for non-dev builds. ' +
      'Set agent.site.url in content.config.ts or disable content.agent.prerender.'
    )
  }

  const sections = agentSectionIds(config.agent?.sections)
  const seenSections = new Set<string>()
  for (const section of config.agent?.sections || []) {
    if (!section.id) {
      throw new Error('@lupinum/ginko-content agent section ids must be non-empty strings.')
    }
    if (seenSections.has(section.id)) {
      throw new Error(`Duplicate Ginko agent section id "${section.id}". Agent section ids must be unique.`)
    }
    seenSections.add(section.id)
  }

  const assertSection = (id: string | undefined, owner: string) => {
    if (!id || id === 'content') return
    if (!sections.has(id)) {
      throw new Error(
        `${owner} references unknown Ginko agent section "${id}". ` +
        'Declare it in agent.sections or use the default "content" section.'
      )
    }
  }

  for (const [name, collection] of Object.entries(config.collections || {})) {
    if (collection.agent?.markdown || collection.agent?.section) {
      assertSection(collection.agent.section, `Collection "${name}"`)
    }
  }

  for (const page of config.agent?.pages || []) {
    assertSection(page.section, `Agent app page "${page.id}"`)
  }
}
