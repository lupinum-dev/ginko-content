import type { ContentTransformer } from '../../types/content'

export const getParser: (extension: string) => ContentTransformer | undefined
export const getTransformers: (extension: string) => ContentTransformer[]
