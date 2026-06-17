import { describe, it, expect } from 'vitest';
import { selectRenderableChatFeed } from './chatSelectors';
import type { AppState } from './appStore';

describe('chatSelectors', () => {
  it('selectRenderableChatFeed correctly joins streams and tool calls', () => {
    const mockState: Partial<AppState> = {
      timeline: [
        { type: 'message', stream_id: 'usr1' },
        { type: 'message', stream_id: 's1' },
        { type: 'tool_call', call_id: 'tc1' }, // Raw timeline might interleave tool calls
        { type: 'context_snapshot', context_id: 'ctx1', seq: 0 }, // Ignored by chat feed
      ],
      streams: {
        'usr1': {
          stream_id: 'usr1',
          role: 'user',
          isComplete: true,
          segments: [{ kind: 'text', content: 'Search for Q3', tokenCount: 0 }],
        },
        's1': {
          stream_id: 's1',
          role: 'agent',
          isComplete: false,
          segments: [
            { kind: 'text', content: 'Let me look that up. ', tokenCount: 0 },
            { kind: 'tool_call', call_id: 'tc1' },
            { kind: 'text', content: ' I found it.', tokenCount: 0 },
          ],
        },
      },
      toolCalls: {
        'tc1': {
          call_id: 'tc1',
          tool_name: 'search',
          args: { q: 'Q3' },
          status: 'pending',
          stream_id: 's1',
          seq: 5,
        },
      },
    };

    const feed = selectRenderableChatFeed(mockState as AppState);

    // Context snapshot and raw tool call timeline items are ignored
    // Only the two messages (usr1, s1) should produce ChatGroups.
    expect(feed).toHaveLength(2);

    expect(feed[0]).toEqual({
      stream_id: 'usr1',
      role: 'user',
      status: 'ended',
      items: [{ kind: 'text', content: 'Search for Q3' }],
    });

    expect(feed[1].stream_id).toBe('s1');
    expect(feed[1].role).toBe('agent');
    expect(feed[1].status).toBe('tool_call_pending');
    expect(feed[1].items).toHaveLength(3);

    expect(feed[1].items[0]).toEqual({ kind: 'text', content: 'Let me look that up. ' });
    expect(feed[1].items[1]).toEqual({
      kind: 'tool_call',
      call_id: 'tc1',
      tool_name: 'search',
      args: { q: 'Q3' },
      result: undefined,
      status: 'pending',
    });
    expect(feed[1].items[2]).toEqual({ kind: 'text', content: ' I found it.' });
  });
});
