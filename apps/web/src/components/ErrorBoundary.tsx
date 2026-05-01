import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { logger } from '@/lib/logger'

interface Props {
  children: ReactNode
  fallback?: (err: Error, reset: () => void) => ReactNode
}

interface State {
  err: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    logger.error(err, {
      module: 'ErrorBoundary',
      componentStack: info.componentStack,
    })
  }

  reset = () => this.setState({ err: null })

  render() {
    if (this.state.err) {
      if (this.props.fallback) return this.props.fallback(this.state.err, this.reset)
      return (
        <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Something went wrong</h1>
          <p className="text-slate-600">
            We logged the problem. Try going back, or reload the page.
          </p>
          <pre className="max-w-full overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-slate-700">
            {this.state.err.message}
          </pre>
          <button onClick={this.reset} className="btn-primary">
            Try again
          </button>
          <a href="/" className="text-sm text-slate-500 underline">
            Go home
          </a>
        </div>
      )
    }
    return this.props.children
  }
}
