/**
 * Browsers put no time limit on fetch: a request the server accepts but never answers
 * stays pending indefinitely. A deadline aborts the request after a fixed time while
 * keeping that case distinguishable from a cancellation by the caller.
 */
export interface Deadline {
  /** Aborts when the caller's signal aborts or the time runs out. */
  signal: AbortSignal
  /** True once the time ran out (and the caller had not already cancelled). */
  expired: () => boolean
  /** Stops the timer; call when the guarded work has finished. */
  clear: () => void
}

export function withDeadline(parent: AbortSignal | undefined, ms: number): Deadline {
  const controller = new AbortController()
  let expired = false
  const onParentAbort = () => controller.abort(parent?.reason)
  if (parent?.aborted) controller.abort(parent.reason)
  else parent?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return
    expired = true
    controller.abort(new DOMException(`No response within ${ms / 1000} s.`, 'TimeoutError'))
  }, ms)
  return {
    signal: controller.signal,
    expired: () => expired,
    clear: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParentAbort)
    },
  }
}

/** Runs work under a deadline, always clearing the timer afterwards. */
export async function underDeadline<T>(
  parent: AbortSignal | undefined,
  ms: number,
  work: (deadline: Deadline) => Promise<T>,
): Promise<T> {
  const deadline = withDeadline(parent, ms)
  try {
    return await work(deadline)
  } finally {
    deadline.clear()
  }
}
