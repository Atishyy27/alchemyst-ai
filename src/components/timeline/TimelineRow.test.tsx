import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineRow } from './TimelineRow';
import { useAppStore } from '@/lib/store/appStore';
import { mockStreams } from '@/lib/__mocks__/mockStreams';

describe('TimelineRow', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('renders context_snapshot and stream with merged segments correctly (sequenceD)', () => {
    const store = useAppStore.getState();
    const messages = mockStreams.sequenceD();
    
    act(() => {
      messages.forEach(msg => store.processServerMessage(msg));
    });

    const state = useAppStore.getState();
    
    // In sequenceD, we pushed a CONTEXT_SNAPSHOT and a stream with TEXT and TOOL_CALL segments.
    // The timeline array should have: 
    // index 0: context_snapshot
    // index 1: message (s1)
    // index 2: tool_call (tc1) -> but we expect TimelineRow to hide this and render inside message.
    
    expect(state.timeline[0].type).toBe('context_snapshot');
    expect(state.timeline[1].type).toBe('message');

    const { container: ctxContainer } = render(<TimelineRow index={0} style={{}} />);
    expect(ctxContainer.textContent).toContain('CONTEXT');
    expect(ctxContainer.textContent).toContain('12 bytes'); // '{"test":123}' is 12 bytes

    // Render Message row
    const { container: msgContainer } = render(<TimelineRow index={1} style={{}} />);
    
    // We expect the message row to contain 3 sub-items: text segment, tool_call segment, text segment
    // Let's verify the text segments
    const textSegments = msgContainer.querySelectorAll('[data-testid^="text-segment-1-"]');
    expect(textSegments).toHaveLength(2);
    expect(textSegments[0].textContent).toContain('Streamed 2 tokens'); // First text.
    expect(textSegments[1].textContent).toContain('Streamed 2 tokens'); // Second text.

    // Let's verify the tool call segment
    const toolSegments = msgContainer.querySelectorAll('[data-testid^="tool-segment-1-"]');
    expect(toolSegments).toHaveLength(1);
    expect(toolSegments[0].textContent).toContain('get_weather');
    expect(toolSegments[0].textContent).toContain('{"loc":"NY"}');
    expect(toolSegments[0].textContent).toContain('completed');
    expect(toolSegments[0].textContent).toContain('{"temp":20}');

    // Render the skipped Tool Call row
    const { container: toolContainer } = render(<TimelineRow index={2} style={{}} />);
    expect(toolContainer.querySelector('.hidden')).toBeInTheDocument();
  });
});
