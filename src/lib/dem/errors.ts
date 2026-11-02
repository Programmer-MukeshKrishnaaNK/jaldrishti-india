export type DemErrorCode = 'NO_COVERAGE' | 'NETWORK' | 'SIGNING' | 'DECODE' | 'ABORTED'

export class DemError extends Error {
  readonly code: DemErrorCode

  constructor(code: DemErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DemError'
    this.code = code
  }
}

export function isAbort(error: unknown): boolean {
  return (
    (error instanceof DemError && error.code === 'ABORTED') ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DemError('ABORTED', 'The request was cancelled.')
}
