import { useRuntimeConfig } from 'nitropack/runtime'

export function getContentRuntimeConfig() {
  return useRuntimeConfig()
}
