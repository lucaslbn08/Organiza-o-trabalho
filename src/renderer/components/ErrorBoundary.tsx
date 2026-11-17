import { Component, type ReactNode } from 'react';
import { api } from '../lib/api';

/** Isola falhas de uma área da interface: o restante do app continua funcionando e o erro vai para o log local. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    void api()?.app.logError(`${this.props.label ?? 'UI'}: ${error.stack ?? error.message}\n${info.componentStack ?? ''}`).catch(() => undefined);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-box" role="alert">
        <strong>Algo deu errado nesta área.</strong>
        <p className="muted">Seus dados salvos não foram afetados. O erro foi registrado no log local.</p>
        <code>{this.state.error.message}</code>
        <div className="row"><button className="btn primary" onClick={() => this.setState({ error: null })}>Tentar novamente</button>
          <button className="btn" onClick={() => location.reload()}>Recarregar a janela</button></div>
      </div>
    );
  }
}

export function installGlobalErrorLogging(): void {
  addEventListener('error', (e) => { void api()?.app.logError('window.onerror: ' + (e.error?.stack ?? e.message)).catch(() => undefined); });
  addEventListener('unhandledrejection', (e) => { void api()?.app.logError('Promise não tratada: ' + ((e.reason as Error)?.stack ?? String(e.reason))).catch(() => undefined); });
}
