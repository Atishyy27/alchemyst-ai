import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ContextPanel } from './ContextPanel';
import { useAppStore } from '../../lib/store/appStore';
import React from 'react';

describe('ContextPanel', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('renders diff colors after second snapshot', () => {
    render(<ContextPanel />);

    expect(screen.getByText('No contexts available')).toBeInTheDocument();

    act(() => {
      useAppStore.getState().processServerMessage({
        type: 'CONTEXT_SNAPSHOT',
        context_id: 'ctx-1',
        data: { a: 1, b: 2 },
        seq: 1
      });
    });

    expect(screen.getByText(/"a":/)).toBeInTheDocument();
    
    const aNode = screen.getByText(/"a":/).parentElement?.parentElement;
    expect(aNode).not.toHaveClass('bg-emerald-500/15');
    expect(aNode).not.toHaveClass('bg-amber-500/15');
    expect(aNode).not.toHaveClass('bg-rose-500/15');

    act(() => {
      useAppStore.getState().processServerMessage({
        type: 'CONTEXT_SNAPSHOT',
        context_id: 'ctx-1',
        data: { a: 2, c: 3 },
        seq: 2
      });
    });

    const newA = screen.getByText(/"a":/).parentElement?.parentElement;
    expect(newA).toHaveClass('bg-amber-500/15');

    const bNode = screen.getByText(/"b":/).parentElement?.parentElement;
    expect(bNode).toHaveClass('bg-rose-500/15');
    expect(bNode).toHaveClass('line-through');

    const cNode = screen.getByText(/"c":/).parentElement?.parentElement;
    expect(cNode).toHaveClass('bg-emerald-500/15');
  });

  it('steps through 3 synthetic snapshots and shows correct diffs', () => {
    render(<ContextPanel />);

    // 1st snapshot
    act(() => {
      useAppStore.getState().processServerMessage({
        type: 'CONTEXT_SNAPSHOT',
        context_id: 'ctx-1',
        data: { step: 1 },
        seq: 1
      });
    });

    // 2nd snapshot
    act(() => {
      useAppStore.getState().processServerMessage({
        type: 'CONTEXT_SNAPSHOT',
        context_id: 'ctx-1',
        data: { step: 2, added: true },
        seq: 2
      });
    });

    // 3rd snapshot
    act(() => {
      useAppStore.getState().processServerMessage({
        type: 'CONTEXT_SNAPSHOT',
        context_id: 'ctx-1',
        data: { step: 3 }, // added is removed
        seq: 3
      });
    });

    const slider = screen.getByTestId('context-slider') as HTMLInputElement;

    // By default, it's at step 3 (index 2), comparing index 1 vs 2
    let stepNode = screen.getByText(/"step":/).parentElement?.parentElement;
    expect(stepNode).toHaveClass('bg-amber-500/15'); // changed
    let addedNode = screen.getByText(/"added":/).parentElement?.parentElement;
    expect(addedNode).toHaveClass('bg-rose-500/15'); // removed

    // Step to index 0
    fireEvent.change(slider, { target: { value: '0' } });
    
    // index 0: { step: 1 } vs nothing (no diff)
    stepNode = screen.getByText(/"step":/).parentElement?.parentElement;
    expect(stepNode).not.toHaveClass('bg-amber-500/15');
    expect(screen.queryByText(/"added":/)).not.toBeInTheDocument();

    // Step to index 1
    fireEvent.change(slider, { target: { value: '1' } });
    
    // index 1 vs 0
    stepNode = screen.getByText(/"step":/).parentElement?.parentElement;
    expect(stepNode).toHaveClass('bg-amber-500/15');
    addedNode = screen.getByText(/"added":/).parentElement?.parentElement;
    expect(addedNode).toHaveClass('bg-emerald-500/15'); // added
  });
});

