import { create } from 'zustand';
import { ConnectionState } from '@/types/stateMachine';
import { ServerMessage } from '@/types/protocol';

// ── Types ─────────────────────────────────────────────────────────────

export type TimelineItemRef =
  | { type: 'message'; stream_id: string }
  | { type: 'tool_call'; call_id: string }
  | { type: 'context_snapshot'; context_id: string; seq: number }
  | { type: 'ping'; seq: number; challenge: string }
  | { type: 'error'; seq: number; code: string; message: string }
  | { type: 'pong'; challenge: string; timestamp: number }
  | { type: 'resume'; last_seq: number; timestamp: number }
  | { type: 'tool_ack'; call_id: string; timestamp: number };

export type StreamSegment =
  | { 
      kind: 'text'; 
      content: string;
      tokenCount: number;
      firstSeq?: number;
      lastSeq?: number;
      startTime?: number;
      endTime?: number;
    }
  | { kind: 'tool_call'; call_id: string };

export interface StreamState {
  stream_id: string;
  role: 'user' | 'agent';
  segments: StreamSegment[];
  isComplete: boolean;
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

export interface TimelineFilter {
  showTokens: boolean;
  showToolCalls: boolean;
  showContexts: boolean;
  showPingsPongs: boolean;
  showErrors: boolean;
  searchQuery: string;
}

export interface AppState {
  timeline: TimelineItemRef[];
  seqToTimeline: Record<number, TimelineItemRef>;

  streams: Record<string, StreamState>;
  toolCalls: Record<string, ToolCallState>;
  contexts: Record<string, ContextSnapshotState[]>;

  connectionStatus: ConnectionState;
  lastProcessedSeq: number;
  timelineFilter: TimelineFilter;
  activeTab: 'timeline' | 'context';

  // Actions
  setActiveTab: (tab: 'timeline' | 'context') => void;
  setConnectionStatus: (status: ConnectionState) => void;
  processServerMessage: (msg: ServerMessage) => void;
  sendUserMessage: (content: string, stream_id: string) => void;
  resetChat: () => void;
  setTimelineFilter: (filter: Partial<TimelineFilter>) => void;
  addClientTimelineEvent: (event: TimelineItemRef) => void;
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
  timelineFilter: {
    showTokens: true,
    showToolCalls: true,
    showContexts: true,
    showPingsPongs: true,
    showErrors: true,
    searchQuery: '',
  },
  activeTab: 'timeline',

  // Actions
  setActiveTab: (tab) => set({ activeTab: tab }),
  setTimelineFilter: (filter) => set((state) => ({ timelineFilter: { ...state.timelineFilter, ...filter } })),
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  resetChat: () => set({
    timeline: [],
    seqToTimeline: {},
    streams: {},
    toolCalls: {},
    contexts: {},
    lastProcessedSeq: 0,
  }),

  addClientTimelineEvent: (event) => set((state) => {
    const updated = [...state.timeline, event];
    return {
      timeline: updated.length > 5000 ? updated.slice(-5000) : updated
    };
  }),

  sendUserMessage: (content, stream_id) => set((state) => {
    const newStream: StreamState = {
      stream_id,
      role: 'user',
      segments: [{ 
        kind: 'text', 
        content,
        tokenCount: 1,
        startTime: Date.now(),
        endTime: Date.now(),
      }],
      isComplete: true,
    };

    return {
      streams: { [stream_id]: newStream },
      toolCalls: {},
      timeline: [{ type: 'message', stream_id }],
      seqToTimeline: {},
      lastProcessedSeq: 0,
    };
  }),

  processServerMessage: (msg: ServerMessage) => set((state) => {
    // We will selectively clone state properties only when they are modified.
    // This avoids unnecessary re-renders in components selecting these properties.
    const nextState = { ...state };
    
    // We don't clone these right away. We clone them just before we mutate them.
    let timelineCloned = false;
    let seqToTimelineCloned = false;
    let streamsCloned = false;
    let toolCallsCloned = false;
    let contextsCloned = false;

    const getTimeline = () => { if (!timelineCloned) { nextState.timeline = [...state.timeline]; timelineCloned = true; } return nextState.timeline; };
    const getSeqToTimeline = () => { if (!seqToTimelineCloned) { nextState.seqToTimeline = { ...state.seqToTimeline }; seqToTimelineCloned = true; } return nextState.seqToTimeline; };
    const getStreams = () => { if (!streamsCloned) { nextState.streams = { ...state.streams }; streamsCloned = true; } return nextState.streams; };
    const getToolCalls = () => { if (!toolCallsCloned) { nextState.toolCalls = { ...state.toolCalls }; toolCallsCloned = true; } return nextState.toolCalls; };
    const getContexts = () => { if (!contextsCloned) { nextState.contexts = { ...state.contexts }; contextsCloned = true; } return nextState.contexts; };

    nextState.lastProcessedSeq = Math.max(state.lastProcessedSeq, msg.seq);

    switch (msg.type) {
      case 'TOKEN': {
        const streams = getStreams();
        let stream = streams[msg.stream_id];
        let isNewStream = false;

        if (!stream) {
          isNewStream = true;
          stream = {
            stream_id: msg.stream_id,
            role: 'agent',
            segments: [],
            isComplete: false,
          };
        } else {
          stream = { ...stream, segments: [...stream.segments] };
        }

        const segments = stream.segments;
        if (segments.length > 0 && segments[segments.length - 1].kind === 'text') {
          const lastIndex = segments.length - 1;
          const lastSeg = segments[lastIndex];
          if (lastSeg.kind === 'text') {
            if (msg.seq <= (lastSeg.lastSeq ?? 0)) {
              break;
            }
            segments[lastIndex] = { 
              ...lastSeg, 
              content: lastSeg.content + msg.text,
              lastSeq: Math.max(lastSeg.lastSeq ?? 0, msg.seq),
              tokenCount: lastSeg.tokenCount + 1
            };
          }
        } else {
          segments.push({ 
            kind: 'text', 
            content: msg.text,
            firstSeq: msg.seq,
            lastSeq: msg.seq,
            tokenCount: 1,
            startTime: Date.now(),
          });
        }
        
        getStreams()[msg.stream_id] = stream;

        const timelineRef: TimelineItemRef = { type: 'message', stream_id: msg.stream_id };
        if (isNewStream) {
          getTimeline().push(timelineRef);
        }
        getSeqToTimeline()[msg.seq] = timelineRef;
        break;
      }

      case 'TOOL_CALL': {
        const toolCalls = getToolCalls();
        if (toolCalls[msg.call_id]) {
          break;
        }

        toolCalls[msg.call_id] = {
          call_id: msg.call_id,
          tool_name: msg.tool_name,
          args: msg.args,
          status: 'pending',
          stream_id: msg.stream_id,
          seq: msg.seq,
        };

        const timelineRef: TimelineItemRef = { type: 'tool_call', call_id: msg.call_id };
        getTimeline().push(timelineRef);
        getSeqToTimeline()[msg.seq] = timelineRef;

        const streams = getStreams();
        let stream = streams[msg.stream_id];
        if (!stream) {
          stream = {
            stream_id: msg.stream_id,
            role: 'agent',
            segments: [],
            isComplete: false,
          };
          getTimeline().push({ type: 'message', stream_id: msg.stream_id });
        }

        streams[msg.stream_id] = {
          ...stream,
          segments: [...stream.segments, { kind: 'tool_call', call_id: msg.call_id }],
        };
        
        break;
      }

      case 'TOOL_RESULT': {
        const toolCalls = getToolCalls();
        const existingToolCall = toolCalls[msg.call_id];
        if (!existingToolCall || existingToolCall.status === 'completed') {
          break;
        }

        toolCalls[msg.call_id] = {
          ...existingToolCall,
          result: msg.result,
          status: 'completed',
          resultSeq: msg.seq,
        };

        const timelineRef: TimelineItemRef = { type: 'tool_call', call_id: msg.call_id };
        getSeqToTimeline()[msg.seq] = timelineRef;

        break;
      }

      case 'CONTEXT_SNAPSHOT': {
        const contexts = getContexts();
        const history = contexts[msg.context_id]
          ? [...contexts[msg.context_id]]
          : [];

        history.push({
          context_id: msg.context_id,
          data: msg.data,
          seq: msg.seq,
          timestamp: Date.now(),
        });

        contexts[msg.context_id] = history;

        const timelineRef: TimelineItemRef = {
          type: 'context_snapshot',
          context_id: msg.context_id,
          seq: msg.seq,
        };
        getTimeline().push(timelineRef);
        getSeqToTimeline()[msg.seq] = timelineRef;
        
        // Cap snapshot history per context to 20
        const MAX_SNAPSHOTS_PER_CONTEXT = 20;
        contexts[msg.context_id] = history.length > MAX_SNAPSHOTS_PER_CONTEXT 
          ? history.slice(-MAX_SNAPSHOTS_PER_CONTEXT) 
          : history;
        break;
      }

      case 'STREAM_END': {
        const streams = getStreams();
        let stream = streams[msg.stream_id];
        if (stream) {
          if (stream.isComplete) break;
          stream = { ...stream, segments: [...stream.segments], isComplete: true };
          if (stream.segments.length > 0) {
            const lastIndex = stream.segments.length - 1;
            const lastSeg = stream.segments[lastIndex];
            if (lastSeg.kind === 'text') {
              stream.segments[lastIndex] = {
                ...lastSeg,
                lastSeq: Math.max(lastSeg.lastSeq ?? 0, msg.seq),
                endTime: Date.now(),
              };
            }
          }
          streams[msg.stream_id] = stream;
          const timelineRef: TimelineItemRef = { type: 'message', stream_id: msg.stream_id };
          getSeqToTimeline()[msg.seq] = timelineRef;
        }
        break;
      }

      case 'PING': {
        const timelineRef: TimelineItemRef = { type: 'ping', seq: msg.seq, challenge: msg.challenge };
        getTimeline().push(timelineRef);
        getSeqToTimeline()[msg.seq] = timelineRef;
        break;
      }
      
      case 'ERROR': {
        const timelineRef: TimelineItemRef = { type: 'error', seq: msg.seq, code: msg.code, message: msg.message };
        getTimeline().push(timelineRef);
        getSeqToTimeline()[msg.seq] = timelineRef;
        break;
      }
    } // <-- Added missing closing brace

    if (nextState.timeline && nextState.timeline.length > 5000) {
      nextState.timeline = nextState.timeline.slice(-5000);
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
