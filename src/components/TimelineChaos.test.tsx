import { render, act, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/lib/store/appStore';
import { TimelinePanel } from '@/components/timeline/TimelinePanel';

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

describe('Timeline Chaos Mode', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('handles PING with empty challenge', () => {
    const store = useAppStore.getState();
    act(() => {
      store.processServerMessage({
        type: 'PING',
        seq: 1,
        challenge: '' // Corrupt challenge
      });
    });

    render(<TimelinePanel />);
    const pingEl = screen.getByText('PING');
    expect(pingEl).toBeDefined();
    const challengeEl = screen.getByText('<empty>');
    expect(challengeEl).toBeDefined();
  });

  it('handles oversized CONTEXT_SNAPSHOT without crashing', () => {
    const store = useAppStore.getState();
    const giantData: Record<string, any> = {};
    for (let i = 0; i < 50000; i++) {
      giantData[`key_${i}`] = `value_${i}`;
    }

    act(() => {
      store.processServerMessage({
        type: 'CONTEXT_SNAPSHOT',
        seq: 1,
        context_id: 'giant_ctx',
        data: giantData
      });
    });

    render(<TimelinePanel />);
    const ctxEl = screen.getByText('CONTEXT');
    expect(ctxEl).toBeDefined();
    
    // Assert length is shown (JSON.stringify of giantData is roughly 1MB+)
    const sizeEl = screen.getByTestId('context-size-0');
    expect(sizeEl.textContent).toContain('bytes');
  });

  it('handles rapid TOOL_CALLs without overwriting', () => {
    const store = useAppStore.getState();
    act(() => {
      store.processServerMessage({
        type: 'TOKEN',
        seq: 1,
        stream_id: 'stream1',
        text: 'hello'
      });
      store.processServerMessage({
        type: 'TOOL_CALL',
        seq: 2,
        stream_id: 'stream1',
        call_id: 'call_1',
        tool_name: 'get_weather',
        args: { location: 'SF' }
      });
      store.processServerMessage({
        type: 'TOOL_CALL',
        seq: 3,
        stream_id: 'stream1',
        call_id: 'call_2',
        tool_name: 'get_time',
        args: {}
      });
    });

    render(<TimelinePanel />);
    const tool1 = screen.getByText(/get_weather/);
    const tool2 = screen.getByText(/get_time/);
    
    expect(tool1).toBeDefined();
    expect(tool2).toBeDefined();
  });
});
