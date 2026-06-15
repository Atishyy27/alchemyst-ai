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
    
    const aNode = screen.getByText(/"a":/).parentElement;
    expect(aNode).not.toHaveClass('bg-green-100/50');
    expect(aNode).not.toHaveClass('bg-yellow-100/50');
    expect(aNode).not.toHaveClass('bg-red-100/50');

    act(() => {
      useAppStore.getState().processServerMessage({
        type: 'CONTEXT_SNAPSHOT',
        context_id: 'ctx-1',
        data: { a: 2, c: 3 },
        seq: 2
      });
    });

    const newA = screen.getByText(/"a":/).parentElement;
    expect(newA).toHaveClass('bg-yellow-100/50');

    const bNode = screen.getByText(/"b":/).parentElement;
    expect(bNode).toHaveClass('bg-red-100/50');
    expect(bNode).toHaveClass('line-through');

    const cNode = screen.getByText(/"c":/).parentElement;
    expect(cNode).toHaveClass('bg-green-100/50');
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
    let stepNode = screen.getByText(/"step":/).parentElement;
    expect(stepNode).toHaveClass('bg-yellow-100/50'); // changed
    let addedNode = screen.getByText(/"added":/).parentElement;
    expect(addedNode).toHaveClass('bg-red-100/50'); // removed

    // Step to index 0
    fireEvent.change(slider, { target: { value: '0' } });
    
    // index 0: { step: 1 } vs nothing (no diff)
    stepNode = screen.getByText(/"step":/).parentElement;
    expect(stepNode).not.toHaveClass('bg-yellow-100/50');
    expect(screen.queryByText(/"added":/)).not.toBeInTheDocument();

    // Step to index 1
    fireEvent.change(slider, { target: { value: '1' } });
    
    // index 1 vs 0
    stepNode = screen.getByText(/"step":/).parentElement;
    expect(stepNode).toHaveClass('bg-yellow-100/50');
    addedNode = screen.getByText(/"added":/).parentElement;
    expect(addedNode).toHaveClass('bg-green-100/50'); // added
  });
});

