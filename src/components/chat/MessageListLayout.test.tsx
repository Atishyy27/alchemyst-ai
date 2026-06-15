import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MessageList } from './MessageList';
import { useAppStore } from '@/lib/store/appStore';
import { castToAny } from '@/lib/unsafe';

// Mock the store so we can control what's rendered
vi.mock('@/lib/store/appStore', () => ({
  useAppStore: vi.fn(),
}));

describe('MessageList segment layout stability', () => {
  it('frozen text container maintains dimensions when ToolCallCard mounts', () => {
    // Mock getBoundingClientRect for JSDOM so we can "capture" it.
    // In a real browser this would return actual layout rects.
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    const mockRect = { width: 500, height: 20, top: 10, left: 10, bottom: 30, right: 510, x: 10, y: 10, toJSON: () => {} };
    Element.prototype.getBoundingClientRect = vi.fn(() => mockRect);
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();

    // Initial state: Only the first text segment
    castToAny(useAppStore).mockReturnValue([
      {
        stream_id: 's1',
        role: 'agent',
        status: 'streaming',
        items: [
          { kind: 'text', content: 'Let me look that up. ' },
        ],
      }
    ]);

    const { rerender } = render(<MessageList />);
    
    const textNode = screen.getByText('Let me look that up.');
    const initialRect = textNode.getBoundingClientRect();
    const initialStyles = window.getComputedStyle(textNode);

    // Ensure it has block-level and no-flex classes
    expect(textNode.className).toContain('block');
    expect(textNode.className).toContain('flex-none');
    expect(textNode.className).toContain('transition-colors');

    // Update state to mount ToolCallCard and subsequent text
    castToAny(useAppStore).mockReturnValue([
      {
        stream_id: 's1',
        role: 'agent',
        status: 'streaming',
        items: [
          { kind: 'text', content: 'Let me look that up. ' },
          { kind: 'tool_call', call_id: 'tc1', tool_name: 'search', args: { q: 'Q3' }, status: 'pending' },
          { kind: 'text', content: ' I found it.' },
        ],
      }
    ]);

    rerender(<MessageList />);

    // Assert that the initial text node is still present
    const updatedTextNode = screen.getByText('Let me look that up.');
    const updatedRect = updatedTextNode.getBoundingClientRect();
    const updatedStyles = window.getComputedStyle(updatedTextNode);

    // Assert dimensions and computed styles are unchanged
    expect(updatedRect).toEqual(initialRect);
    expect(updatedStyles.flexGrow).toBe(initialStyles.flexGrow);
    expect(updatedStyles.flexShrink).toBe(initialStyles.flexShrink);

    // Restore mock
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });
});
