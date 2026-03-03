/**
 * error-boundary.tsx
 *
 * Catch JavaScript errors anywhere in the child component tree,
 * log those errors, and display a fallback UI instead of crashing.
 */

import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-dvh bg-gray-950 text-gray-100 p-6">
          <div className="bg-gray-900 border border-red-900/50 p-8 rounded-3xl max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-500 mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <path d="M12 9v4"/>
                <path d="M12 17h.01"/>
              </svg>
              <h1 className="text-xl font-bold">Application Error</h1>
            </div>
            <p className="text-gray-300">
              The application encountered an unexpected error and could not continue.
            </p>
            <div className="bg-gray-950 p-4 rounded-xl overflow-auto border border-gray-800 text-sm font-mono text-red-400">
              {this.state.error?.message || 'Unknown error'}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-full font-medium transition-colors border border-gray-700 w-full"
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
