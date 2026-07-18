import type { ContentCollectionI18nConfig } from '../../types/config'

export interface ContentI18nConfigInput {
  defaultLocale?: string
  locales?: string[]
}

export interface CollectionI18nInput {
  source?: string | string[]
  i18n?: boolean | ContentI18nConfigInput
}

export type RuntimeCollectionI18nInput = CollectionI18nInput

export interface RuntimeContentI18nInput extends ContentI18nConfigInput {
  collections?: Record<string, RuntimeCollectionI18nInput | undefined>
}

export const normalizeI18nConfig = (
  config?: ContentI18nConfigInput
): ContentCollectionI18nConfig | undefined => {
  if (!config?.defaultLocale || !config.locales?.length) {
    return undefined
  }

  return {
    defaultLocale: config.defaultLocale,
    locales: config.locales
  }
}

export const resolveCollectionI18nConfig = (
  collection?: CollectionI18nInput,
  globalI18n?: ContentI18nConfigInput,
  options: {
    warnMissingGlobal?: boolean
  } = {}
): ContentCollectionI18nConfig | undefined => {
  if (collection?.i18n === false) {
    return undefined
  }
  if (collection?.i18n && collection.i18n !== true) {
    return normalizeI18nConfig(collection.i18n)
  }

  const inherited = normalizeI18nConfig(globalI18n)
  if (inherited) {
    return inherited
  }

  if (collection?.i18n === true && options.warnMissingGlobal) {
    console.warn(`[content] Collection source "${collection.source}" set i18n: true but no content.i18n config was found in nuxt.config.ts. i18n is disabled for this collection.`)
  }

  return undefined
}

export const resolveRuntimeCollectionI18nConfig = (
  collection: string,
  content: RuntimeContentI18nInput
): ContentCollectionI18nConfig | undefined => {
  return resolveCollectionI18nConfig(content.collections?.[collection], content)
}
