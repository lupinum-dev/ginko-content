import type { ParsedContentMeta } from '../../types/content'
import { buildNavigation } from '../../features/navigation/build'
import { getContentRuntimeConfig } from './runtime-config'

export function createNav (contents: ParsedContentMeta[], configs: Record<string, ParsedContentMeta>) {
  const { navigation } = getContentRuntimeConfig().public.content
  if (navigation === false) {
    return []
  }

  return buildNavigation(contents, configs, navigation.fields)
}
