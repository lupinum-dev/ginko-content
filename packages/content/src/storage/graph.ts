import type { H3Event } from 'h3'
import type { ContentGraph } from '../core/content/graph'
import { buildContentGraph } from '../core/content/graph'
import { memoizeRuntimeValue } from '../integrations/nitro/context'
import { contentConfig } from './driver'
import { getContentsList } from './contents'

export const getContentGraph = async (event: H3Event): Promise<ContentGraph> => {
  return await memoizeRuntimeValue(event, 'graph', async () => {
    const config = contentConfig()
    const contents = await getContentsList(event)
    return buildContentGraph(contents, {
      locales: config.locales,
      defaultLocale: config.defaultLocale
    })
  })
}
