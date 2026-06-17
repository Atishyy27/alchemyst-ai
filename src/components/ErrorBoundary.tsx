'use client';
import React from 'react';

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{padding:'1rem',color:'var(--color-text-danger)',fontSize:13}}>
        {this.props.label ?? 'Panel'} error: {(this.state.error as Error).message}
        <button onClick={() => this.setState({ error: null })} style={{marginLeft:8}}>
          Retry
        </button>
      </div>
    );
    return this.props.children;
  }
}
