import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { ToolCallCard } from './ToolCallCard';

// Mock the highlightRegistry to avoid react-window dependency in tests
vi.mock('@/lib/highlightRegistry', () => ({
  highlightRegistry: {
    highlightTimelineToolCall: vi.fn(),
  },
}));

describe('ToolCallCard reconnect state', () => {
  const CALL_ID = 'tc_test_123';

  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        connectionStatus: 'connected',
        timeline: [{ type: 'tool_call', call_id: CALL_ID }],
        seqToTimeline: {},
        streams: {},
        toolCalls: {
          [CALL_ID]: {
            call_id: CALL_ID,
            tool_name: 'search_db',
            args: { query: 'test' },
            status: 'pending',
            stream_id: 's_test',
            seq: 5,
          },
        },
        contexts: {},
        lastProcessedSeq: 5,
      });
    });
  });

  it('shows normal "pending" when connected', () => {
    render(<ToolCallCard call_id={CALL_ID} />);
    const status = screen.getByTestId(`tool-status-${CALL_ID}`);
    expect(status.textContent).toBe('pending');
  });

  it('shows "Waiting for result (reconnecting...)" when pending + reconnecting', () => {
    act(() => {
      useAppStore.setState({ connectionStatus: 'reconnecting' });
    });

    render(<ToolCallCard call_id={CALL_ID} />);
    const status = screen.getByTestId(`tool-status-${CALL_ID}`);
    expect(status.textContent).toBe('Waiting for result (reconnecting...)');
  });

  it('shows "Waiting for result (reconnecting...)" when pending + disconnected', () => {
    act(() => {
      useAppStore.setState({ connectionStatus: 'disconnected' });
    });

    render(<ToolCallCard call_id={CALL_ID} />);
    const status = screen.getByTestId(`tool-status-${CALL_ID}`);
    expect(status.textContent).toBe('Waiting for result (reconnecting...)');
  });

  it('transitions to completed state after TOOL_RESULT + connected', () => {
    // Start in pending + reconnecting
    act(() => {
      useAppStore.setState({ connectionStatus: 'reconnecting' });
    });
    const { rerender } = render(<ToolCallCard call_id={CALL_ID} />);
    expect(screen.getByTestId(`tool-status-${CALL_ID}`).textContent)
      .toBe('Waiting for result (reconnecting...)');

    // Simulate TOOL_RESULT arriving (via processServerMessage) and connection restoring
    act(() => {
      useAppStore.getState().processServerMessage({
        type: 'TOOL_RESULT',
        seq: 10,
        call_id: CALL_ID,
        result: { rows: 42 },
        stream_id: 's_test',
      });
      useAppStore.setState({ connectionStatus: 'connected' });
    });

    rerender(<ToolCallCard call_id={CALL_ID} />);
    const status = screen.getByTestId(`tool-status-${CALL_ID}`);
    expect(status.textContent).toBe('completed');
  });
});
