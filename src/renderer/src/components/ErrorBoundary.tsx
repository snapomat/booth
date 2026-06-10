import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
}

/**
 * Fängt Render-Fehler ab, zeigt eine ruhige Meldung und lädt die Oberfläche nach
 * einigen Sekunden automatisch neu – die Box bleibt nie kaputt stehen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] Render-Fehler', error, info.componentStack)
    setTimeout(() => window.location.reload(), 4000)
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-ink text-cream">
        <p className="font-display text-4xl font-light italic">Einen Moment …</p>
        <p className="font-mono text-xs tracking-[0.3em] text-cream-dim uppercase">
          Die Box startet gleich neu
        </p>
        <span className="mt-2 h-10 w-10 animate-spin rounded-full border-2 border-cream/20 border-t-flare" />
      </div>
    )
  }
}
