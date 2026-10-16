// UI error boundary (plan Task 22, spec §6.4): any render-time crash
// swaps the app for a fallback that offers "Copy link to this state" so
// a bug report can carry the exact URL that failed — the URL holds all
// restorable state.

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private copyLink = () => {
    void navigator.clipboard.writeText(window.location.href);
  };

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <h1>Something went wrong</h1>
        <p>
          NeoPhylo hit an unexpected error. Copy the link to this state and
          include it in a bug report — it captures the lesson, data and
          settings you were looking at.
        </p>
        <button type="button" onClick={this.copyLink}>
          Copy link to this state
        </button>
      </div>
    );
  }
}
