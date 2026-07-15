import { useCookie, useRoute, useState } from '#imports'

export const useContentPreview = () => {
  const previewToken = useCookie<string | null>('previewToken')
  const warningShown = useState('ginko-content:preview-warning-shown', () => false)

  const getPreviewToken = () => {
    return previewToken.value || undefined
  }

  const setPreviewToken = (token: string | undefined) => {
    previewToken.value = token || null

    if (import.meta.client) {
      window.location.reload()
    }
  }

  const isEnabled = () => {
    const query = useRoute().query
    if (Object.prototype.hasOwnProperty.call(query, 'preview') && !query.preview) {
      return false
    }

    if (query.preview || previewToken.value) {
      if (import.meta.dev && !warningShown.value) {
        console.warn(
          '[content] Preview mode enabled since a preview token is set (either in query or cookie).'
        )
        warningShown.value = true
      }
      return true
    }

    return false
  }

  return {
    isEnabled,
    getPreviewToken,
    setPreviewToken
  }
}
