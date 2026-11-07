import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Catches a failed 3D load (network, WebGL) so the rest of the landing page keeps working. */
export class OvwErrorBoundary extends Component<{ onError: (msg: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown, _info: ErrorInfo) {
    this.props.onError(error instanceof Error ? error.message : String(error))
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
