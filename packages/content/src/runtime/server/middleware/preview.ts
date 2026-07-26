import { defineEventHandler, setHeader } from 'h3'
import { isPreview } from '../../../integrations/nitro/preview'

export default defineEventHandler((event) => {
  if (isPreview(event)) {
    setHeader(event, 'Cache-Control', 'private, no-store')
  }
})
