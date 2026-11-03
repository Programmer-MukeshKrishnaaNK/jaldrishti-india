import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary, ErrorFallback } from './ErrorBoundary'

describe('ErrorBoundary', () => {
  it('captures any thrown value as an Error', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new TypeError('boom')).error).toBeInstanceOf(TypeError)
    expect(ErrorBoundary.getDerivedStateFromError('Failed to fetch dynamically imported module').error?.message).toBe(
      'Failed to fetch dynamically imported module',
    )
  })

  it('renders its children while nothing has failed', () => {
    expect(renderToStaticMarkup(<ErrorBoundary label="PaaniPulse">ok</ErrorBoundary>)).toBe('ok')
  })
})

describe('ErrorFallback', () => {
  const error = new Error('Cannot read properties of null')
  error.stack = 'Error: Cannot read properties of null\n    at Terrain3DView'

  it('offers recovery and names what failed', () => {
    const html = renderToStaticMarkup(
      <ErrorFallback label="The 3D view" error={error} componentStack={null} onRetry={() => {}} showDetails={false}>
        <button type="button">Back to 2D</button>
      </ErrorFallback>,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('The 3D view stopped working')
    expect(html).toContain('Try again')
    expect(html).toContain('Back to 2D')
    expect(html).toContain('Reload the page')
    // Production keeps the message but not the stack.
    expect(html).toContain('Cannot read properties of null')
    expect(html).not.toContain('at Terrain3DView')
  })

  it('shows the stack and component stack in development', () => {
    const html = renderToStaticMarkup(
      <ErrorFallback label="PaaniPulse" error={error} componentStack={'\n    at App'} onRetry={() => {}} showDetails />,
    )
    expect(html).toContain('at Terrain3DView')
    expect(html).toContain('Component stack:')
    expect(html).toContain('<details class="error-fallback-details" open="">')
  })
})
