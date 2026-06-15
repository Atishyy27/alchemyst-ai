import type { AppState } from './appStore';

// ── View-Model Types ───────────────────────────────────────────────────

export interface TextChatItem {
  kind: 'text';
  content: string;
  firstSeq?: number;
}

export interface ToolCallChatItem {
  kind: 'tool_call';
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: 'pending' | 'completed';
}

export type ChatItem = TextChatItem | ToolCallChatItem;

export interface ChatGroup {
  stream_id: string;
  role: 'user' | 'agent';
  status: 'streaming' | 'tool_call_pending' | 'ended';
  items: ChatItem[];
}

// ── Selectors ─────────────────────────────────────────────────────────

export type DerivedStreamStatus = 'streaming' | 'tool_call_pending' | 'ended';

export const selectDerivedStreamStatus = (stream_id: string) => (state: AppState): DerivedStreamStatus => {
  const stream = state.streams[stream_id];
  if (!stream) return 'ended'; // Failsafe
  
  if (stream.isComplete) return 'ended';

  // Check if ANY tool call segment associated with this stream is still pending
  const hasPendingTools = stream.segments.some(seg => 
    seg.kind === 'tool_call' && state.toolCalls[seg.call_id]?.status === 'pending'
  );

  return hasPendingTools ? 'tool_call_pending' : 'streaming';
};

/**
 * Derives a fully unified, renderable chat feed from the raw store state.
 * 
 * Filters the timeline for top-level messages (streams) and joins their
 * segments with the toolCalls dictionary to produce rich `ChatItem`s.
 * 
 * This isolates UI components from the normalized state tree and completely
 * abstracts away the `seq` and timeline-reference logic.
 */
let lastState: AppState | null = null;
let lastResult: ChatGroup[] = [];

export const selectRenderableChatFeed = (state: AppState): ChatGroup[] => {
  if (state === lastState) {
    return lastResult;
  }

  const groups: ChatGroup[] = [];

  for (const ref of state.timeline) {
    if (ref.type !== 'message') {
      continue;
    }

    const stream = state.streams[ref.stream_id];
    if (!stream) continue;

    const items: ChatItem[] = [];

    for (const segment of stream.segments) {
      if (segment.kind === 'text') {
        items.push({ kind: 'text', content: segment.content, firstSeq: segment.firstSeq });
      } else if (segment.kind === 'tool_call') {
        const toolData = state.toolCalls[segment.call_id];
        if (toolData) {
          items.push({
            kind: 'tool_call',
            call_id: toolData.call_id,
            tool_name: toolData.tool_name,
            args: toolData.args,
            result: toolData.result,
            status: toolData.status,
          });
        }
      }
    }

    groups.push({
      stream_id: stream.stream_id,
      role: stream.role,
      status: selectDerivedStreamStatus(stream.stream_id)(state),
      items,
    });
  }

  lastState = state;
  lastResult = groups;
  return groups;
};
