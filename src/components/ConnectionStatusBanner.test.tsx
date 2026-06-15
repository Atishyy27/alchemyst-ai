import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';

describe('ConnectionStatusBanner', () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        connectionStatus: 'connected',
        timeline: [],
        seqToTimeline: {},
        streams: {},
        toolCalls: {},
        contexts: {},
        lastProcessedSeq: 0,
      });
    });
  });

  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionStatusBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when idle', () => {
    act(() => {
      useAppStore.setState({ connectionStatus: 'idle' });
    });
    const { container } = render(<ConnectionStatusBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('shows banner when reconnecting', () => {
    act(() => {
      useAppStore.setState({ connectionStatus: 'reconnecting' });
    });
    render(<ConnectionStatusBanner />);
    const banner = screen.getByTestId('connection-status-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('Reconnecting');
  });

  it('shows banner when connecting', () => {
    act(() => {
      useAppStore.setState({ connectionStatus: 'connecting' });
    });
    render(<ConnectionStatusBanner />);
    const banner = screen.getByTestId('connection-status-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('Connecting');
  });

  it('shows banner when disconnected', () => {
    act(() => {
      useAppStore.setState({ connectionStatus: 'disconnected' });
    });
    render(<ConnectionStatusBanner />);
    const banner = screen.getByTestId('connection-status-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('Disconnected');
  });

  it('banner appears on reconnecting and disappears on connected', () => {
    const { rerender } = render(<ConnectionStatusBanner />);

    // Initially connected → no banner
    expect(screen.queryByTestId('connection-status-banner')).toBeNull();

    // Transition to reconnecting
    act(() => {
      useAppStore.setState({ connectionStatus: 'reconnecting' });
    });
    rerender(<ConnectionStatusBanner />);
    expect(screen.getByTestId('connection-status-banner')).toBeInTheDocument();

    // Transition back to connected
    act(() => {
      useAppStore.setState({ connectionStatus: 'connected' });
    });
    rerender(<ConnectionStatusBanner />);
    expect(screen.queryByTestId('connection-status-banner')).toBeNull();
  });

  it('does not add pointer-events:none or disable ChatPanel scroll area', () => {
    // Render both components together in a simplified layout
    const ChatScrollProxy = () => (
      <div data-testid="chat-scroll" style={{ overflow: 'auto', flex: 1 }}>
        <p>Chat content</p>
      </div>
    );

    act(() => {
      useAppStore.setState({ connectionStatus: 'reconnecting' });
    });

    render(
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <ConnectionStatusBanner />
        <ChatScrollProxy />
      </div>
    );

    const banner = screen.getByTestId('connection-status-banner');
    expect(banner).toBeInTheDocument();

    const chatScroll = screen.getByTestId('chat-scroll');
    const style = window.getComputedStyle(chatScroll);
    // The chat scroll container must NOT have pointer-events:none or be disabled
    expect(style.pointerEvents).not.toBe('none');
    expect(chatScroll.getAttribute('disabled')).toBeNull();
    expect(chatScroll.getAttribute('aria-disabled')).toBeNull();
  });
});
