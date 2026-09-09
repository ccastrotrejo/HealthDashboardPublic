import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Card as AstryxCard } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';

interface Props {
  children: ReactNode;
  /** Optional label so the fallback can name the broken section. */
  section?: string;
  /** Optional accessible alternative for nonessential enhancements. */
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  error: Error | null;
}

/**
 * Stops a chart crash from blanking the whole page. Catches render errors in
 * any subtree and shows a friendly Astryx `EmptyState` fallback. Logs the
 * actual error to the console so we can debug from devtools.
 *
 * Class component because React's error-boundary API still requires one.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Don't include this in any production telemetry (we have none anyway).
    // Console-only is the right level for a personal dashboard.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.section ? ` · ${this.props.section}` : ''}]`, error, info);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <AstryxCard variant="red" padding={5}>
          <EmptyState
            isCompact
            title={
              this.props.section ? `${this.props.section} failed to render` : 'Something broke'
            }
            description="Open the browser console for details. The rest of the dashboard should still work."
          />
        </AstryxCard>
      );
    }
    return this.props.children;
  }
}
