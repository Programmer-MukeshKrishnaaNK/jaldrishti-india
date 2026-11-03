import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { underDeadline, withDeadline } from './deadline'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('withDeadline', () => {
  it('aborts and reports expiry when the time runs out', () => {
    const deadline = withDeadline(undefined, 1000)
    vi.advanceTimersByTime(999)
    expect(deadline.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.expired()).toBe(true)
  })

  it('follows a cancellation by the caller without calling it an expiry', () => {
    const parent = new AbortController()
    const deadline = withDeadline(parent.signal, 1000)
    parent.abort()
    expect(deadline.signal.aborted).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(deadline.expired()).toBe(false)
  })

  it('starts aborted when the caller has already cancelled', () => {
    const parent = new AbortController()
    parent.abort()
    expect(withDeadline(parent.signal, 1000).signal.aborted).toBe(true)
  })

  it('stops the timer once the work has finished', async () => {
    const parent = new AbortController()
    let seen: AbortSignal | undefined
    await underDeadline(parent.signal, 1000, async (d) => {
      seen = d.signal
    })
    vi.advanceTimersByTime(5000)
    expect(seen?.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
