import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error?.message || 'Une erreur inattendue est survenue.';
    try {
      const parsed = JSON.parse(readable) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error) {
        readable = `Erreur Firestore (${parsed.operationType || 'opération'} sur ${parsed.path || 'collection'}) : ${parsed.error}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: readable };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('DISCRET ErrorBoundary caught error:', error, info);
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen w-full bg-[#050507] text-[#F4F4F5] flex items-center justify-center p-4">
        <div className="glass-elevated w-full max-w-md rounded-2xl p-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-lg font-semibold text-white">
              Interruption de session
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400 break-words">
              {this.state.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-medium text-zinc-950 hover:bg-zinc-200 transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Recharger DISCRET</span>
          </button>
        </div>
      </div>
    );
  }
}
