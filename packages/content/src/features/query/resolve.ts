import type { ContentQueryCountResponse, ContentQueryFindOneResponse, ContentQueryFindResponse } from '../../types/api'

type QueryResolvedValue<T> =
  | Array<T>
  | T
  | number
  | undefined

type QueryResponseValue<T> =
  | ContentQueryCountResponse
  | ContentQueryFindResponse<T>
  | ContentQueryFindOneResponse<T>

export const resolveQueryResult = <T>(result: QueryResponseValue<T> | T): QueryResolvedValue<T> => {
  if (!result) {
    return result
  }

  if (typeof result === 'object' && 'result' in result) {
    return result.result as QueryResolvedValue<T>
  }

  return result as QueryResolvedValue<T>
}
