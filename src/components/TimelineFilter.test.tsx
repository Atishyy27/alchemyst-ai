import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/lib/store/appStore';
import { mockStreams } from '@/lib/__mocks__/mockStreams';
import { TimelinePanel } from '@/components/timeline/TimelinePanel';

// Mock react-window to actually render the rows so we can find them
vi.mock('react-window', () => {
  const { forwardRef, useImperativeHandle } = require('react');
  return {
    List: ({ rowComponent, rowCount, listRef }: any) => {
      if (listRef) {
        if (typeof listRef === 'function') listRef({ scrollToRow: () => {} });
        else listRef.current = { scrollToRow: () => {} };
      }
      const Child = rowComponent;
      const items = [];
      for(let i = 0; i < rowCount; i++) {
        items.push(<Child key={i} index={i} style={{}} />);
      }
      return <div data-testid="mock-virtualized-list">{items}</div>;
    }
  };
});

describe('Timeline Filter', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('filters timeline rows correctly', async () => {
    // 1. Setup state with mixed entries
    const store = useAppStore.getState();
    const messages = mockStreams.sequenceD(); // has text, tool call, context
    
    act(() => {
      messages.forEach(msg => store.processServerMessage(msg));
    });

    render(<TimelinePanel />);

    // Check initial render (everything visible)
    const tokensFilter = screen.getByTestId('filter-tokens') as HTMLInputElement;
    const toolsFilter = screen.getByTestId('filter-toolcalls') as HTMLInputElement;
    const contextsFilter = screen.getByTestId('filter-contexts') as HTMLInputElement;
    const searchInput = screen.getByTestId('timeline-search-input') as HTMLInputElement;

    // The sequenceD has:
    // - context snapshot
    // - text segment
    // - tool_call (get_weather)
    
    // Check elements exist
    const textSegment = screen.getByTestId('text-segment-1-0'); // index 1 is message, segment 0 is text
    const toolSegment = screen.getByTestId('tool-segment-1-1'); // index 1 is message, segment 1 is tool_call
    const contextRow = screen.getByTestId('timeline-row-0'); // index 0 is context
    
    expect(textSegment.className).not.toContain('hidden');
    expect(toolSegment.className).not.toContain('hidden');
    expect(contextRow.className).not.toContain('hidden');

    // 2. Apply a type filter (uncheck tools)
    act(() => {
      fireEvent.click(toolsFilter);
    });

    // Tool segment should be hidden
    expect(toolSegment.className).toContain('hidden');
    expect(textSegment.className).not.toContain('hidden'); // Text still visible

    // Uncheck contexts
    act(() => {
      fireEvent.click(contextsFilter);
    });
    expect(contextRow.className).toContain('hidden');

    // 3. Re-enable all, then test search
    act(() => {
      fireEvent.click(toolsFilter);
      fireEvent.click(contextsFilter);
    });
    
    expect(toolSegment.className).not.toContain('hidden');
    expect(contextRow.className).not.toContain('hidden');

    // Search for 'weather' (should match tool call, not context or text)
    act(() => {
      fireEvent.change(searchInput, { target: { value: 'weather' } });
    });

    // Tool segment has 'get_weather'
    expect(toolSegment.className).not.toContain('hidden');
    
    // Text segment and context do not have 'weather'
    expect(textSegment.className).toContain('hidden');
    expect(contextRow.className).toContain('hidden');
  });
});
