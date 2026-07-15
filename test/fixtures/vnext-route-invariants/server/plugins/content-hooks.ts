import { defineNitroPlugin } from 'nitropack/runtime'

// VNEXT 20.1: a `content:file:beforeParse` hook that changes a route fact
// (here, the `order` frontmatter used to sort route listings/navigation).
// Both a direct query and the generated static route render through this
// same real ingest pipeline, so the mutated fact must appear identically in
// both.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('content:file:beforeParse', (file) => {
    if (typeof file.body === 'string' && file.body.includes('navHookMarker: true')) {
      file.body = file.body.replace('order: 99', 'order: 1')
    }
  })
})
