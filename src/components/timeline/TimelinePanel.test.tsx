import { render, screen, act } from '@testing-library/react';
import { mockStreams } from '@/lib/__mocks__/mockStreams';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelinePanel } from './TimelinePanel';
import { useAppStore } from '@/lib/store/appStore';
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
      const renderCount = Math.min(rowCount, 15); // Render max 15 items
      for(let i = 0; i < renderCount; i++) {
        items.push(<Child key={i} index={i} style={{}} />);
      }
      return <div data-testid="mock-virtualized-list">{items}</div>;
    }
  };
});

describe('TimelinePanel - Virtualization', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('renders a large timeline (1000+ entries) with fewer than 100 DOM nodes', async () => {
    const store = useAppStore.getState();
    const messages = mockStreams.largeTimeline(1000);

    act(() => {
      messages.forEach(m => store.processServerMessage(m));
    });

    const timelineLength = useAppStore.getState().timeline.length;
    expect(timelineLength).toBeGreaterThanOrEqual(1000);

    const { container } = render(<TimelinePanel />);

    // react-window renders a wrapper div and some inner elements.
    // Let's count how many rows are rendered by querying for data-testid matches.
    const renderedRows = container.querySelectorAll('[data-testid^="timeline-row-"]');
    
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(100);
  });
});
