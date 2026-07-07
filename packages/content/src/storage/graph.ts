import type { H3Event } from 'h3'
import type { ContentGraph } from '../core/content/graph'
import { buildContentGraph } from '../core/content/graph'
import { memoizeRuntimeValue } from '../integrations/nitro/context'
import { contentConfig } from './driver'
import { getContentsList } from './contents'
import { getProcessGraph } from './snapshot-runtime'

const isPrerendering = import.meta.prerender
const usesProcessSnapshot = process.env.NODE_ENV === 'production' && !isPrerendering

export const getContentGraph = async (event: H3Event): Promise<ContentGraph> => {
  if (usesProcessSnapshot) {
    return getProcessGraph(event)
  }

  return await memoizeRuntimeValue(event, 'graph', async () => {
    const config = contentConfig()
    const contents = await getContentsList(event)
    return buildContentGraph(contents, {
      locales: config.locales,
      defaultLocale: config.defaultLocale
    })
  })
}
