import { create } from 'zustand';
import { ConnectionState } from '@/types/stateMachine';
import { ServerMessage } from '@/types/protocol';

// ── Types ─────────────────────────────────────────────────────────────

export type TimelineItemRef =
  | { type: 'message'; stream_id: string }
  | { type: 'tool_call'; call_id: string }
  | { type: 'context_snapshot'; context_id: string; index: number };

export type StreamSegment =
  | { kind: 'text'; content: string }
  | { kind: 'tool_call'; call_id: string };

export interface StreamState {
  stream_id: string;
  role: 'user' | 'agent';
  segments: StreamSegment[];
  isComplete: boolean;
  seqStart?: number;
  seqEnd?: number;
}

export interface ToolCallState {
  call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: 'pending' | 'completed';
  stream_id: string;
  seq: number;
  resultSeq?: number;
}

export interface ContextSnapshotState {
  context_id: string;
  data: Record<string, unknown>;
  seq: number;
  timestamp: number;
}

// ── State Interface ───────────────────────────────────────────────────

export interface AppState {
  timeline: TimelineItemRef[];
  seqToTimeline: Record<number, TimelineItemRef>;

  streams: Record<string, StreamState>;
  toolCalls: Record<string, ToolCallState>;
  contexts: Record<string, ContextSnapshotState[]>;

  connectionStatus: ConnectionState;
  lastProcessedSeq: number;

  // Actions
  setConnectionStatus: (status: ConnectionState) => void;
  processServerMessage: (msg: ServerMessage) => void;
  sendUserMessage: (content: string, stream_id: string) => void;
  resetChat: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()((set) => ({
  // Initial State
  timeline: [],
  seqToTimeline: {},
  streams: {},
  toolCalls: {},
  contexts: {},
  connectionStatus: 'idle',
  lastProcessedSeq: 0,

  // Actions
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  resetChat: () => set({
    timeline: [],
    seqToTimeline: {},
    streams: {},
    toolCalls: {},
    contexts: {},
    lastProcessedSeq: 0,
  }),

  sendUserMessage: (content, stream_id) => set((state) => {
    const newStream: StreamState = {
      stream_id,
      role: 'user',
      segments: [{ kind: 'text', content }],
      isComplete: true,
    };

    return {
      streams: { ...state.streams, [stream_id]: newStream },
      timeline: [...state.timeline, { type: 'message', stream_id }],
    };
  }),

  processServerMessage: (msg: ServerMessage) => set((state) => {
    const nextState = { ...state };
    // Create shallow copies of structures we might mutate
    nextState.timeline = [...state.timeline];
    nextState.seqToTimeline = { ...state.seqToTimeline };
    nextState.streams = { ...state.streams };
    nextState.toolCalls = { ...state.toolCalls };
    nextState.contexts = { ...state.contexts };

    // Update global seq tracker
    nextState.lastProcessedSeq = Math.max(state.lastProcessedSeq, msg.seq);

    switch (msg.type) {
      case 'TOKEN': {
        let stream = nextState.streams[msg.stream_id];
        let isNewStream = false;

        if (!stream) {
          isNewStream = true;
          stream = {
            stream_id: msg.stream_id,
            role: 'agent',
            segments: [],
            isComplete: false,
            seqStart: msg.seq,
          };
        } else {
          // Shallow copy the stream object to mutate
          stream = { ...stream, segments: [...stream.segments] };
        }

        const segments = stream.segments;
        if (segments.length > 0 && segments[segments.length - 1].kind === 'text') {
          // Append to existing text segment
          const lastIndex = segments.length - 1;
          const lastSeg = segments[lastIndex] as { kind: 'text'; content: string };
          segments[lastIndex] = { ...lastSeg, content: lastSeg.content + msg.text };
        } else {
          // Push new text segment
          segments.push({ kind: 'text', content: msg.text });
        }

        stream.seqEnd = msg.seq;
        nextState.streams[msg.stream_id] = stream;

        const timelineRef: TimelineItemRef = { type: 'message', stream_id: msg.stream_id };
        if (isNewStream) {
          nextState.timeline.push(timelineRef);
        }
        nextState.seqToTimeline[msg.seq] = timelineRef;
        break;
      }

      case 'TOOL_CALL': {
        // Idempotency check: ignore if already exists
        if (nextState.toolCalls[msg.call_id]) {
          break;
        }

        nextState.toolCalls[msg.call_id] = {
          call_id: msg.call_id,
          tool_name: msg.tool_name,
          args: msg.args,
          status: 'pending',
          stream_id: msg.stream_id,
          seq: msg.seq,
        };

        const timelineRef: TimelineItemRef = { type: 'tool_call', call_id: msg.call_id };
        nextState.timeline.push(timelineRef);
        nextState.seqToTimeline[msg.seq] = timelineRef;

        let stream = nextState.streams[msg.stream_id];
        if (!stream) {
          stream = {
            stream_id: msg.stream_id,
            role: 'agent',
            segments: [],
            isComplete: false,
            seqStart: msg.seq,
          };
          nextState.timeline.push({ type: 'message', stream_id: msg.stream_id });
        }

        nextState.streams[msg.stream_id] = {
          ...stream,
          segments: [...stream.segments, { kind: 'tool_call', call_id: msg.call_id }],
          seqEnd: Math.max(stream.seqEnd ?? 0, msg.seq),
        };
        
        break;
      }

      case 'TOOL_RESULT': {
        const existingToolCall = nextState.toolCalls[msg.call_id];
        // Idempotency check: ignore if already completed or doesn't exist
        if (!existingToolCall || existingToolCall.status === 'completed') {
          break;
        }

        nextState.toolCalls[msg.call_id] = {
          ...existingToolCall,
          result: msg.result,
          status: 'completed',
          resultSeq: msg.seq,
        };

        const timelineRef: TimelineItemRef = { type: 'tool_call', call_id: msg.call_id };
        nextState.seqToTimeline[msg.seq] = timelineRef;

        const stream = nextState.streams[msg.stream_id];
        if (stream) {
          nextState.streams[msg.stream_id] = {
            ...stream,
            seqEnd: Math.max(stream.seqEnd ?? 0, msg.seq),
          };
        }
        break;
      }

      case 'CONTEXT_SNAPSHOT': {
        const history = nextState.contexts[msg.context_id]
          ? [...nextState.contexts[msg.context_id]]
          : [];

        history.push({
          context_id: msg.context_id,
          data: msg.data,
          seq: msg.seq,
          timestamp: Date.now(),
        });

        nextState.contexts[msg.context_id] = history;

        const timelineRef: TimelineItemRef = {
          type: 'context_snapshot',
          context_id: msg.context_id,
          index: history.length - 1,
        };
        nextState.timeline.push(timelineRef);
        nextState.seqToTimeline[msg.seq] = timelineRef;
        break;
      }

      case 'STREAM_END': {
        const stream = nextState.streams[msg.stream_id];
        if (stream) {
          nextState.streams[msg.stream_id] = {
            ...stream,
            isComplete: true,
            seqEnd: Math.max(stream.seqEnd ?? 0, msg.seq),
          };
          const timelineRef: TimelineItemRef = { type: 'message', stream_id: msg.stream_id };
          nextState.seqToTimeline[msg.seq] = timelineRef;
        }
        break;
      }

      case 'PING':
      case 'ERROR':
        // Not projected into the store for UI rendering
        break;
    }

    return nextState;
  }),
}));

// ── Selectors ─────────────────────────────────────────────────────────

export const selectTimeline = (state: AppState) => state.timeline;
export const selectStream = (stream_id: string) => (state: AppState) => state.streams[stream_id];
export const selectToolCall = (call_id: string) => (state: AppState) => state.toolCalls[call_id];
export const selectContextHistory = (context_id: string) => (state: AppState) => state.contexts[context_id];
export const selectTimelineRefBySeq = (seq: number) => (state: AppState) => state.seqToTimeline[seq];
export const selectConnectionStatus = (state: AppState) => state.connectionStatus;
