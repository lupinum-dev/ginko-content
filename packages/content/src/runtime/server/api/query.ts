import { defineEventHandler } from 'h3'
import { getContentQuery } from '../../utils/query'
import { getContentProvider } from '../providers'

export default defineEventHandler(async (event) => {
  return await (await getContentProvider(event)).query(event, getContentQuery(event))
})
