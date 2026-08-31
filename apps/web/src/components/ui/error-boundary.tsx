import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './states';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** A rendering failure must not leave the user staring at a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('AI Footprint failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl py-20">
          <ErrorState error={this.state.error} onRetry={() => window.location.reload()} />
        </div>
      );
    }
    return this.props.children;
  }
}
