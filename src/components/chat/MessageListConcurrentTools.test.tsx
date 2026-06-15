import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MessageList } from './MessageList';
import { useAppStore } from '@/lib/store/appStore';
import { castToAny } from '@/lib/unsafe';

// Mock the store
vi.mock('@/lib/store/appStore', () => ({
  useAppStore: vi.fn(),
}));

describe('MessageList Concurrent Tool Calls', () => {
  it('renders multiple tool calls and updates their status independently', () => {
    // Mock scrollIntoView for jsdom
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();

    // Initial state: One stream, two tool calls, both pending
    const initialFeed = [
      {
        stream_id: 's1',
        role: 'agent',
        status: 'streaming',
        items: [
          { kind: 'tool_call', call_id: 'tc1', tool_name: 'fetch_data', args: {}, status: 'pending' },
          { kind: 'tool_call', call_id: 'tc2', tool_name: 'calculate_sum', args: {}, status: 'pending' },
        ],
      }
    ];

    const initialToolCalls = {
      'tc1': { call_id: 'tc1', tool_name: 'fetch_data', args: {}, status: 'pending', stream_id: 's1', seq: 1 },
      'tc2': { call_id: 'tc2', tool_name: 'calculate_sum', args: {}, status: 'pending', stream_id: 's1', seq: 2 },
    };

    // We have to mock the store implementation so that MessageList gets the feed
    // and ToolCallCard gets the specific toolCall item.
    castToAny(useAppStore).mockImplementation((selector: unknown) => {
      const mockState = {
        toolCalls: initialToolCalls,
        connectionStatus: 'connected',
      };
      
      const sel = castToAny(selector);
      if (sel.name === 'selectRenderableChatFeed') {
        return initialFeed;
      }
      
      return sel(mockState);
    });

    const { rerender } = render(<MessageList />);

    // Assert two tool cards rendered with correct names in arrival order
    const toolNames = screen.getAllByText(/fetch_data\(\)|calculate_sum\(\)/);
    expect(toolNames).toHaveLength(2);
    expect(toolNames[0].textContent).toBe('fetch_data()');
    expect(toolNames[1].textContent).toBe('calculate_sum()');

    // Both should be pending
    const pendingBadges = screen.getAllByText('pending');
    expect(pendingBadges).toHaveLength(2);

    // Update state: tc2 completes before tc1
    const updatedToolCalls = {
      ...initialToolCalls,
      'tc2': { ...initialToolCalls['tc2'], status: 'completed', result: { sum: 42 } },
    };

    const updatedFeed = [
      {
        stream_id: 's1',
        role: 'agent',
        status: 'streaming',
        items: [
          { kind: 'tool_call', call_id: 'tc1', tool_name: 'fetch_data', args: {}, status: 'pending' },
          { kind: 'tool_call', call_id: 'tc2', tool_name: 'calculate_sum', args: {}, status: 'completed', result: { sum: 42 } },
        ],
      }
    ];

    castToAny(useAppStore).mockImplementation((selector: unknown) => {
      const mockState = { toolCalls: updatedToolCalls, connectionStatus: 'connected' };
      const sel = castToAny(selector);
      if (sel.name === 'selectRenderableChatFeed') {
        return updatedFeed;
      }
      return sel(mockState);
    });

    rerender(<MessageList />);

    // tc1 should still be pending
    const finalPendingBadges = screen.getAllByText('pending');
    expect(finalPendingBadges).toHaveLength(1);
    
    // The pending one should belong to fetch_data()
    // We can check the DOM structure to ensure fetch_data is pending and calculate_sum is completed.
    const completedBadge = screen.getByText('completed');
    expect(completedBadge).toBeDefined();

    // We can also verify that calculate_sum() shows the result
    expect(screen.getByText(/{\s*"sum":\s*42\s*}/)).toBeDefined();

    // Restore mock
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });
});
