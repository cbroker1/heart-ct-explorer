/** Keeps a failed lazy chunk or WebGL crash inside its own card instead of taking the page down. */
import { Component, type ReactNode } from 'react'

export class Boundary extends Component<{ fallback: (err: Error, retry: () => void) => ReactNode; children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { console.warn('[lab] section error:', err.message) }
  retry = () => this.setState({ err: null })
  render() { return this.state.err ? this.props.fallback(this.state.err, this.retry) : this.props.children }
}
