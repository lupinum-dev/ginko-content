import type { ContentCollectionHandle } from '../config'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by generated app types
  interface GinkoContentCollectionMap {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by generated app types
  interface GinkoContentCollectionI18nMap {}
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by generated app types
export interface ContentCollectionMap extends GinkoContentCollectionMap {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by generated app types
export interface ContentCollectionI18nMap extends GinkoContentCollectionI18nMap {}

export type ContentCollectionName = keyof GinkoContentCollectionMap & string
export type ContentCollectionItem<K extends ContentCollectionName> = ContentCollectionMap[K]
export type ContentCollectionStringName = [ContentCollectionName] extends [never] ? string : ContentCollectionName
export type ContentCollectionTarget = ContentCollectionHandle | ContentCollectionStringName
