import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/lib/store/appStore';
import { mockStreams } from '@/lib/__mocks__/mockStreams';
import { ToolCallCard } from '@/components/chat/ToolCallCard';
import { TimelinePanel } from '@/components/timeline/TimelinePanel';
import { highlightRegistry } from '@/lib/highlightRegistry';

// Mock react-window to actually render the rows so we can find them
vi.mock('react-window', () => {
  const { useLayoutEffect } = require('react');
  return {
    List: ({ rowComponent, rowCount, listRef }: any) => {
      useLayoutEffect(() => {
        if (listRef) {
          if (typeof listRef === 'function') listRef({ scrollToRow: () => {} });
          else listRef.current = { scrollToRow: () => {} };
        }
      }, [listRef]);
      const Child = rowComponent;
      const items = [];
      for(let i = 0; i < rowCount; i++) {
        items.push(<Child key={i} index={i} style={{}} />);
      }
      return <div data-testid="mock-virtualized-list">{items}</div>;
    }
  };
});

describe('Highlight Integration', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('clicking a ToolCallCard highlights the corresponding timeline row', async () => {
    // 1. Setup state with sequenceD (contains a tool call 'tc1')
    const store = useAppStore.getState();
    const messages = mockStreams.sequenceD();
    
    act(() => {
      messages.forEach(msg => store.processServerMessage(msg));
    });

    // 2. Render both TimelinePanel (to register refs) and ToolCallCard
    render(
      <div>
        <TimelinePanel />
        <ToolCallCard call_id="tc1" />
      </div>
    );

    // Give it a tiny tick for refs to attach
    await new Promise(r => setTimeout(r, 0));

    // 3. Find the tool call card in chat
    const chatCard = screen.getByTestId('tool-call-tc1');
    expect(chatCard).toBeInTheDocument();

    // 4. Find the timeline tool call row
    // Inside TimelineRow, it attaches data-testid="tool-segment-{index}-{segmentIndex}"
    // But we just registered the ref via `highlightRegistry`. Let's verify it got registered.
    expect(highlightRegistry['timelineNodeRefs'].has('timeline_tool_tc1')).toBe(true);

    const timelineToolRow = highlightRegistry['timelineNodeRefs'].get('timeline_tool_tc1') as HTMLElement;
    expect(timelineToolRow.getAttribute('data-highlighted')).toBeNull();

    // 5. Click the tool call card
    act(() => {
      fireEvent.click(chatCard);
    });

    // 6. Assert highlight
    // The registry sets highlight after a 150ms timeout to allow react-window to render, 
    // so we need to wait for the timeout.
    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    expect(timelineToolRow.getAttribute('data-highlighted')).toBe('true');
  });
});
