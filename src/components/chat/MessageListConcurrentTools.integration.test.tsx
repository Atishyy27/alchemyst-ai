import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { MessageList } from './MessageList';
import { useAppStore } from '@/lib/store/appStore';

describe('MessageList Concurrent Tools Integration', () => {
  beforeEach(() => {
    act(() => {
      useAppStore.getState().resetChat();
      useAppStore.getState().setConnectionStatus('connected');
    });
    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('Test A: does not resume streaming when first of two tool calls resolves', () => {
    render(<MessageList />);

    const process = useAppStore.getState().processServerMessage;

    act(() => {
      process({ type: 'TOKEN', stream_id: 's1', text: 'Hello', seq: 1 });
      process({ type: 'TOOL_CALL', stream_id: 's1', call_id: 'tc1', tool_name: 'fetch_data', args: {}, seq: 2 });
      process({ type: 'TOOL_CALL', stream_id: 's1', call_id: 'tc2', tool_name: 'calculate_sum', args: {}, seq: 3 });
      process({ type: 'TOOL_RESULT', stream_id: 's1', call_id: 'tc1', result: { ok: true }, seq: 4 });
    });

    // stream should still be tool_call_pending because tc2 is pending
    const feed = useAppStore.getState().streams['s1'];
    expect(feed).toBeDefined();

    const toolNames = screen.getAllByText(/fetch_data\(\)|calculate_sum\(\)/);
    expect(toolNames).toHaveLength(2);
    
    // Assert: no new TOKEN renders after TOOL_RESULT_1.
    // The only text should be "Hello"
    expect(screen.getByText('Hello')).toBeInTheDocument();
    
    // Assert: TOOL_CALL_2 card still shows "pending"
    const pendingBadges = screen.getAllByText('pending');
    expect(pendingBadges).toHaveLength(1); // tc2 is pending
    
    // tc1 is completed
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('Test B: resumes streaming after both tool calls resolve', () => {
    render(<MessageList />);

    const process = useAppStore.getState().processServerMessage;

    act(() => {
      process({ type: 'TOKEN', stream_id: 's2', text: 'Start', seq: 1 });
      process({ type: 'TOOL_CALL', stream_id: 's2', call_id: 'tc1', tool_name: 'fetch_data', args: {}, seq: 2 });
      process({ type: 'TOOL_CALL', stream_id: 's2', call_id: 'tc2', tool_name: 'calculate_sum', args: {}, seq: 3 });
      process({ type: 'TOOL_RESULT', stream_id: 's2', call_id: 'tc1', result: { ok: true }, seq: 4 });
      process({ type: 'TOOL_RESULT', stream_id: 's2', call_id: 'tc2', result: { sum: 42 }, seq: 5 });
      process({ type: 'TOKEN', stream_id: 's2', text: ' End', seq: 6 });
    });

    // Assert: final TOKEN renders after both results
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument(); // streaming text renders "Start" and "End" in separate segments!

    // Assert: segment order is [text, tool1, tool2, text] in DOM
    // Since everything is in a column, we can check the DOM element order.
    // But testing exact element order in React Testing Library can be tricky.
    // We can query all elements within the message container.
    const container = screen.getByText('Start').closest('.space-y-2');
    expect(container).not.toBeNull();
    const children = Array.from(container!.children);
    
    expect(children).toHaveLength(4);
    // first is text
    expect(children[0].textContent).toContain('Start');
    // second is tool call 1
    expect(children[1].textContent).toContain('fetch_data()');
    // third is tool call 2
    expect(children[2].textContent).toContain('calculate_sum()');
    // fourth is text
    expect(children[3].textContent).toContain('End');
  });

  it('Test C: handles out-of-order tool results correctly', () => {
    render(<MessageList />);
    const process = useAppStore.getState().processServerMessage;

    act(() => {
      process({ type: 'TOKEN', stream_id: 's3', text: 'Start', seq: 1 });
      process({ type: 'TOOL_CALL', stream_id: 's3', call_id: 'tc1', tool_name: 'fetch_data', args: {}, seq: 2 });
      process({ type: 'TOOL_CALL', stream_id: 's3', call_id: 'tc2', tool_name: 'calculate_sum', args: {}, seq: 3 });
      process({ type: 'TOOL_RESULT', stream_id: 's3', call_id: 'tc2', result: { sum: 42 }, seq: 4 }); // result for tc2 arrives first
      process({ type: 'TOOL_RESULT', stream_id: 's3', call_id: 'tc1', result: { ok: true }, seq: 5 });
      process({ type: 'TOKEN', stream_id: 's3', text: ' Done', seq: 6 });
    });

    // Assert: both tool cards show COMPLETED
    const completedBadges = screen.getAllByText('completed');
    expect(completedBadges).toHaveLength(2);
    
    // Assert: final TOKEN renders
    expect(screen.getByText('Done')).toBeInTheDocument();
  });
});
