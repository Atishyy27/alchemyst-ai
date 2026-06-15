import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageList } from './MessageList';
import { useAppStore } from '@/lib/store/appStore';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('MessageList - Tool Replay', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('handles a replay scenario with TOOL_CALL and TOOL_RESULT without duplicating cards or state', async () => {
    useAppStore.setState({ connectionStatus: 'connected' });
    const store = useAppStore.getState();

    // 1. Send first part of stream and TOOL_CALL
    act(() => {
      store.processServerMessage({ type: 'TOKEN', stream_id: 'stream1', seq: 1, text: 'Let me check that. ' });
      store.processServerMessage({
        type: 'TOOL_CALL',
        stream_id: 'stream1',
        seq: 2,
        call_id: 'call_123',
        tool_name: 'get_weather',
        args: { location: 'London' }
      });
    });

    const { rerender } = render(<MessageList />);

    // Wait and verify initial tool card
    expect(screen.getByTestId('tool-call-call_123')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-call_123')).toHaveTextContent('pending');
    expect(Object.keys(useAppStore.getState().toolCalls).length).toBe(1);

    // 2. Simulate disconnect / reconnect and replay
    // Replay TOOL_CALL
    act(() => {
      store.processServerMessage({
        type: 'TOOL_CALL',
        stream_id: 'stream1',
        seq: 2, // Replaying same sequence
        call_id: 'call_123',
        tool_name: 'get_weather',
        args: { location: 'London' }
      });
    });

    rerender(<MessageList />);

    // Verify no duplicates
    expect(screen.getAllByTestId('tool-call-call_123').length).toBe(1);
    expect(Object.keys(useAppStore.getState().toolCalls).length).toBe(1);

    // 3. Replay TOOL_RESULT
    act(() => {
      store.processServerMessage({
        type: 'TOOL_RESULT',
        stream_id: 'stream1',
        seq: 3,
        call_id: 'call_123',
        result: { temp: 20 }
      });
    });

    rerender(<MessageList />);

    expect(screen.getAllByTestId('tool-call-call_123').length).toBe(1);
    expect(Object.keys(useAppStore.getState().toolCalls).length).toBe(1);
    expect(screen.getByTestId('tool-call-call_123')).toHaveTextContent('completed');
    
    // Attempt replay of TOOL_RESULT just to be sure
    act(() => {
      store.processServerMessage({
        type: 'TOOL_RESULT',
        stream_id: 'stream1',
        seq: 3,
        call_id: 'call_123',
        result: { temp: 20 }
      });
    });

    rerender(<MessageList />);
    expect(screen.getAllByTestId('tool-call-call_123').length).toBe(1);
    expect(Object.keys(useAppStore.getState().toolCalls).length).toBe(1);
    expect(screen.getByTestId('tool-call-call_123')).toHaveTextContent('completed');
  });
});
