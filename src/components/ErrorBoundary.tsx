import { Component, type ErrorInfo, type ReactNode } from 'react'
import './ErrorBoundary.css'

interface ErrorBoundaryProps {
  /** What failed, in the fallback's heading, e.g. "PaaniPulse" or "The 3D view". */
  label: string
  /** Extra recovery actions shown beside "Try again". */
  actions?: ReactNode
  /** Runs before "Try again" re-renders the children, to clear whatever caused the error. */
  onReset?: () => void
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

/**
 * Catches an error while rendering its children, including a failed lazy import, and
 * shows a recovery panel instead of a blank page. The development build shows the stack.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  reset = () => {
    this.props.onReset?.()
    this.setState({ error: null, componentStack: null })
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    return (
      <ErrorFallback label={this.props.label} error={error} componentStack={componentStack} onRetry={this.reset}>
        {this.props.actions}
      </ErrorFallback>
    )
  }
}

export function ErrorFallback({
  label,
  error,
  componentStack,
  onRetry,
  children,
  showDetails = import.meta.env.DEV,
}: {
  label: string
  error: Error
  componentStack: string | null
  onRetry: () => void
  children?: ReactNode
  showDetails?: boolean
}) {
  return (
    <div className="error-fallback" role="alert">
      <h2>{label} stopped working</h2>
      <p>Something went wrong while loading or drawing this part of the page. Your selection and data sources are unaffected.</p>
      <div className="button-row">
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
        {children}
        <button type="button" className="button button-quiet" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
      <details className="error-fallback-details" open={showDetails}>
        <summary>Technical details</summary>
        <pre className="mono">
          {error.name}: {error.message}
          {showDetails && error.stack ? `\n\n${error.stack}` : ''}
          {showDetails && componentStack ? `\n\nComponent stack:${componentStack}` : ''}
        </pre>
      </details>
    </div>
  )
}
