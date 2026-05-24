export const useRouteBaseName = () => (value: { name?: unknown } | unknown) => {
  if (value && typeof value === 'object' && 'name' in value) {
    return typeof value.name === 'string' ? value.name.replace(/___([^_]+)$/, '') : undefined
  }

  return undefined
}

export const useSetI18nParams = () => () => {}

export const useSwitchLocalePath = () => () => ''
