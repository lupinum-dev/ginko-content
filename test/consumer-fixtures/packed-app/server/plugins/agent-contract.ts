import {
        agentRawPathForRoute
      } from '@lupinum/ginko-content/agent'

      if (agentRawPathForRoute('/docs/intro') !== '/raw/docs/intro.md') {
        throw new Error('Packed agent path helper export is invalid')
      }

      export default defineNitroPlugin((nitroApp) => {
        nitroApp.hooks.hook('error', (error) => {
          console.error('PACKED_CONSUMER_SERVER_ERROR', error)
        })
      })
    
