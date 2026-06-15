import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/lib/store/appStore';
import { TimelinePanel } from '@/components/timeline/TimelinePanel';
import { Profiler } from 'react';

// We want to count exactly how many times TimelinePanel renders,
// ignoring its children. We can mock it, or we can just spy on the hook it uses.
// But the easiest way to count TimelinePanel's renders is to mock react-window's List
// and see how many times List is rendered, because List is rendered exactly when TimelinePanel renders.

let listRenderCount = 0;

vi.mock('react-window', () => {
  const { forwardRef, useImperativeHandle } = require('react');
  return {
    List: ({ rowComponent, rowCount, listRef }: any) => {
      listRenderCount++;
      if (listRef) {
        if (typeof listRef === 'function') listRef({ scrollToRow: () => {} });
        else listRef.current = { scrollToRow: () => {} };
      }
      const Child = rowComponent;
      const items = [];
      // Only render 5 visible rows to simulate windowing
      for(let i = 0; i < Math.min(rowCount, 5); i++) {
        items.push(<Child key={i} index={i} style={{}} />);
      }
      return <div data-testid="mock-virtualized-list">{items}</div>;
    }
  };
});

describe('Timeline Performance', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
    listRenderCount = 0;
  });

  it('renders efficiently under live token stream', async () => {
    const store = useAppStore.getState();

    render(<TimelinePanel />);

    const start = performance.now();
    let seq = 1;

    // We start a stream
    act(() => {
      store.processServerMessage({
        type: 'TOKEN',
        seq: seq++,
        stream_id: 'perf-stream',
        text: 'Hello ',
      });
    });

    // Simulate 200 tokens (5 seconds of 40 tokens/sec)
    for (let i = 0; i < 200; i++) {
      act(() => {
        store.processServerMessage({
          type: 'TOKEN',
          seq: seq++,
          stream_id: 'perf-stream',
          text: ' token',
        });
      });
    }

    const end = performance.now();
    const duration = end - start;

    console.log(`TimelinePanel (List) re-renders: ${listRenderCount}`);
    console.log(`Processing time: ${duration.toFixed(2)}ms`);

    // List renders once on mount (with 0 items, so actually List is NOT rendered when timeline is empty!)
    // Wait, TimelinePanel renders "No timeline events yet" when timeline.length === 0.
    // So List renders 0 times initially.
    // Then we add 1 stream, timeline.length becomes 1. List renders for the FIRST time.
    // Then 200 tokens arrive. The timeline array reference DOES NOT CHANGE.
    // So TimelinePanel does NOT re-render, and List does NOT re-render!
    // Total List renders should be EXACTLY 1.
    expect(listRenderCount).toBeLessThanOrEqual(2); 
    expect(duration).toBeLessThan(2500); // Should be very fast!
  });
});
