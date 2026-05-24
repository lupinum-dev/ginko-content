/**
 * A discriminated-union result type used at **internal** boundaries where
 * failure is expected (duplicate canonical IDs, invalid front-matter,
 * conflicting refs). Programmer errors — invalid operator operands,
 * unreachable branches — still throw.
 *
 * Use this at internal boundaries where input/content failures are expected.
 * Keep plain throws for programmer mistakes and impossible branches.
 *
 * @example
 * const outcome = validateContentGraph(docs, config)
 * if (!outcome.ok) {
 *   return outcome // propagate up
 * }
 * useGraph(outcome.value)
 */
export type Result<T, E> =
  | { ok: true, value: T }
  | { ok: false, error: E }

/** Produce a success result. Use at the emit site, not at call sites. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

/** Produce a failure result. Use at the emit site, not at call sites. */
export const fail = <E>(error: E): Result<never, E> => ({ ok: false, error })
