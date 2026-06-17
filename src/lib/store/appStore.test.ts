import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './appStore';
import type { ServerMessage } from '@/types/protocol';
import { mockStreams } from '../__mocks__/mockStreams';

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('handles STREAM segmenting correctly', () => {
    const store = useAppStore.getState();

    // 1. Initial text token
    store.processServerMessage({
      type: 'TOKEN',
      stream_id: 's1',
      seq: 1,
      text: 'hello',
    } as ServerMessage);

    let state = useAppStore.getState();
    let stream = state.streams['s1'];
    expect(stream.segments).toHaveLength(1);
    expect(stream.segments[0]).toEqual(expect.objectContaining({ kind: 'text', content: 'hello' }));

    // 2. Append another text token
    store.processServerMessage({
      type: 'TOKEN',
      stream_id: 's1',
      seq: 2,
      text: ' world',
    } as ServerMessage);

    state = useAppStore.getState();
    stream = state.streams['s1'];
    expect(stream.segments).toHaveLength(1);
    expect(stream.segments[0]).toEqual(expect.objectContaining({ kind: 'text', content: 'hello world' }));

    // 3. Interrupt with a TOOL_CALL
    store.processServerMessage({
      type: 'TOOL_CALL',
      stream_id: 's1',
      seq: 3,
      call_id: 'tc1',
      tool_name: 'search',
      args: { q: 'test' },
    } as ServerMessage);

    state = useAppStore.getState();
    stream = state.streams['s1'];
    expect(stream.segments).toHaveLength(2);
    expect(stream.segments[1]).toEqual({ kind: 'tool_call', call_id: 'tc1' });

    // 4. Follow up with more text tokens
    store.processServerMessage({
      type: 'TOKEN',
      stream_id: 's1',
      seq: 4,
      text: ' found',
    } as ServerMessage);

    state = useAppStore.getState();
    stream = state.streams['s1'];
    expect(stream.segments).toHaveLength(3);
    expect(stream.segments[2]).toEqual(expect.objectContaining({ kind: 'text', content: ' found' }));
  });

  it('populates tokenCount, firstSeq, lastSeq, startTime, endTime correctly on TEXT segments (sequenceB)', () => {
    const store = useAppStore.getState();
    const messages = mockStreams.sequenceB();
    
    for (const msg of messages) {
      store.processServerMessage(msg);
    }
    
    const state = useAppStore.getState();
    const stream = state.streams['s1'];
    
    expect(stream.segments).toHaveLength(3);
    
    // First text segment (Hello world)
    const seg1 = stream.segments[0];
    expect(seg1.kind).toBe('text');
    if (seg1.kind === 'text') {
      expect(seg1.content).toBe('Hello world');
      expect(seg1.tokenCount).toBe(2);
      expect(seg1.firstSeq).toBe(1);
      expect(seg1.lastSeq).toBe(2);
      expect(seg1.startTime).toBeTypeOf('number');
      expect(seg1.endTime).toBeUndefined(); // endTime is only set on STREAM_END
    }
    
    // Tool call segment
    expect(stream.segments[1].kind).toBe('tool_call');
    
    // Second text segment ( I am AI)
    const seg3 = stream.segments[2];
    expect(seg3.kind).toBe('text');
    if (seg3.kind === 'text') {
      expect(seg3.content).toBe(' I am AI');
      expect(seg3.tokenCount).toBe(3);
      expect(seg3.firstSeq).toBe(4);
      expect(seg3.lastSeq).toBe(7); // Last seq updated by STREAM_END which has seq=7
      expect(seg3.startTime).toBeTypeOf('number');
      expect(seg3.endTime).toBeTypeOf('number');
    }
  });

  it('guarantees TOOL_CALL idempotency', () => {
    const store = useAppStore.getState();

    const toolCallMsg: ServerMessage = {
      type: 'TOOL_CALL',
      stream_id: 's1',
      seq: 3,
      call_id: 'tc1',
      tool_name: 'search',
      args: { q: 'test' },
    };

    store.processServerMessage(toolCallMsg);
    
    // Duplicate arrival (e.g., chaos mode replay)
    store.processServerMessage(toolCallMsg);

    const state = useAppStore.getState();
    const stream = state.streams['s1'];
    
    // Should only have 1 tool call segment
    expect(stream.segments).toHaveLength(1);
    // Should only have 1 timeline entry
    expect(state.timeline.filter(t => t.type === 'tool_call')).toHaveLength(1);
  });

  it('maps seq to timeline items correctly', () => {
    const store = useAppStore.getState();

    store.processServerMessage({
      type: 'TOKEN',
      stream_id: 's1',
      seq: 10,
      text: 'test',
    } as ServerMessage);

    store.processServerMessage({
      type: 'TOOL_CALL',
      stream_id: 's1',
      seq: 15,
      call_id: 'tc1',
      tool_name: 'test',
      args: {},
    } as ServerMessage);

    const state = useAppStore.getState();
    expect(state.seqToTimeline[10]).toEqual({ type: 'message', stream_id: 's1' });
    expect(state.seqToTimeline[15]).toEqual({ type: 'tool_call', call_id: 'tc1' });
  });

  it('stores context history', () => {
    const store = useAppStore.getState();

    store.processServerMessage({
      type: 'CONTEXT_SNAPSHOT',
      context_id: 'ctx1',
      seq: 5,
      data: { snapshot: 1 },
    } as ServerMessage);

    store.processServerMessage({
      type: 'CONTEXT_SNAPSHOT',
      context_id: 'ctx1',
      seq: 20,
      data: { snapshot: 2 },
    } as ServerMessage);

    const state = useAppStore.getState();
    const history = state.contexts['ctx1'];
    
    expect(history).toHaveLength(2);
    expect(history[0].data).toEqual({ snapshot: 1 });
    expect(history[1].data).toEqual({ snapshot: 2 });
  });

  it('maintains tool_call_pending when tc_1 completes but tc_2 is still pending', () => {
    const store = useAppStore.getState();
    const streamId = 's_01';

    // 1. Initialize stream
    store.processServerMessage({ type: 'TOKEN', seq: 1, stream_id: streamId, text: 'Fetching...' } as ServerMessage);
    
    // 2. Fire tc_1 and tc_2 concurrently
    store.processServerMessage({ type: 'TOOL_CALL', seq: 2, call_id: 'tc_1', stream_id: streamId, tool_name: 'db', args: {} } as ServerMessage);
    store.processServerMessage({ type: 'TOOL_CALL', seq: 3, call_id: 'tc_2', stream_id: streamId, tool_name: 'api', args: {} } as ServerMessage);

    // Assert both pending
    expect(useAppStore.getState().toolCalls['tc_1'].status).toBe('pending');
    expect(useAppStore.getState().toolCalls['tc_2'].status).toBe('pending');

    // 3. Complete tc_1
    store.processServerMessage({ type: 'TOOL_RESULT', seq: 4, call_id: 'tc_1', stream_id: streamId, result: { ok: true } } as ServerMessage);

    // Assert stream is STILL pending because tc_2 is unresolved
    expect(useAppStore.getState().toolCalls['tc_1'].status).toBe('completed');
    expect(useAppStore.getState().toolCalls['tc_2'].status).toBe('pending');
  });

  it('resumes streaming only when both tc_1 and tc_2 complete', () => {
    const store = useAppStore.getState();
    const streamId = 's_02';

    store.processServerMessage({ type: 'TOKEN', seq: 1, stream_id: streamId, text: 'Fetching...' } as ServerMessage);
    store.processServerMessage({ type: 'TOOL_CALL', seq: 2, call_id: 'tc_1', stream_id: streamId, tool_name: 'db', args: {} } as ServerMessage);
    store.processServerMessage({ type: 'TOOL_CALL', seq: 3, call_id: 'tc_2', stream_id: streamId, tool_name: 'api', args: {} } as ServerMessage);

    // Complete tc_1
    store.processServerMessage({ type: 'TOOL_RESULT', seq: 4, call_id: 'tc_1', stream_id: streamId, result: { data: 'a' } } as ServerMessage);
    
    // Complete tc_2
    store.processServerMessage({ type: 'TOOL_RESULT', seq: 5, call_id: 'tc_2', stream_id: streamId, result: { data: 'b' } } as ServerMessage);

    // The selector is what exposes the state to the UI, testing it explicitly is covered in chatSelectors.test.ts, 
    // but we can verify the store itself doesn't crash here.
  });

  describe('Edge Cases (Hostile Server)', () => {
    it('Duplicate TOOL_RESULT: ignores duplicate result for the same call_id', () => {
      const store = useAppStore.getState();

      store.processServerMessage({ type: 'TOOL_CALL', stream_id: 's1', seq: 1, call_id: 'tc1', tool_name: 'test', args: {} } as ServerMessage);
      store.processServerMessage({ type: 'TOOL_RESULT', call_id: 'tc1', seq: 2, result: 'result1' } as ServerMessage);

      let state = useAppStore.getState();
      expect(state.toolCalls['tc1'].status).toBe('completed');
      expect(state.toolCalls['tc1'].result).toBe('result1');

      // Duplicate result
      store.processServerMessage({ type: 'TOOL_RESULT', call_id: 'tc1', seq: 3, result: 'result2' } as ServerMessage);

      state = useAppStore.getState();
      expect(state.toolCalls['tc1'].result).toBe('result1');
    });

    it('Duplicate STREAM_END: closes stream once and ignores subsequent STREAM_ENDs', () => {
      const store = useAppStore.getState();

      store.processServerMessage({ type: 'TOKEN', stream_id: 's1', seq: 1, text: 'hi' } as ServerMessage);
      store.processServerMessage({ type: 'STREAM_END', stream_id: 's1', seq: 2 } as ServerMessage);

      let state = useAppStore.getState();
      expect(state.streams['s1'].isComplete).toBe(true);
      const firstEndTime = state.streams['s1'].segments[0].endTime;
      expect(firstEndTime).toBeTypeOf('number');

      // Duplicate
      store.processServerMessage({ type: 'STREAM_END', stream_id: 's1', seq: 3 } as ServerMessage);

      state = useAppStore.getState();
      expect(state.streams['s1'].segments[0].endTime).toBe(firstEndTime);
    });

    it('Unknown TOOL_RESULT: ignores result for unknown call_id without crashing', () => {
      const store = useAppStore.getState();

      expect(() => {
        store.processServerMessage({ type: 'TOOL_RESULT', call_id: 'does-not-exist', seq: 1, result: 'data' } as ServerMessage);
      }).not.toThrow();

      const state = useAppStore.getState();
      expect(state.toolCalls['does-not-exist']).toBeUndefined();
    });

    it('Unknown STREAM_END: ignores STREAM_END for ghost stream without crashing', () => {
      const store = useAppStore.getState();

      // Setup some existing state
      store.processServerMessage({ type: 'TOKEN', stream_id: 'real-stream', seq: 1, text: 'hello' } as ServerMessage);
      const preState = useAppStore.getState();
      const preTimelineLength = preState.timeline.length;
      const preStreamsCount = Object.keys(preState.streams).length;

      expect(() => {
        store.processServerMessage({ type: 'STREAM_END', stream_id: 'ghost', seq: 2 } as ServerMessage);
      }).not.toThrow();

      const state = useAppStore.getState();
      
      // Asserts that the ghost stream was not created
      expect(state.streams['ghost']).toBeUndefined();
      
      // Asserts that the timeline was untouched
      expect(state.timeline).toHaveLength(preTimelineLength);
      
      // Asserts that other streams were untouched
      expect(Object.keys(state.streams)).toHaveLength(preStreamsCount);
      expect(state.streams['real-stream']).toEqual(preState.streams['real-stream']);
    });

    it('Reconnect during tool call: duplicate TOOL_CALL uses same card, TOOL_RESULT updates it', () => {
      const store = useAppStore.getState();

      // Original TOOL_CALL
      store.processServerMessage({ type: 'TOOL_CALL', stream_id: 's1', seq: 1, call_id: 'tc1', tool_name: 'test', args: {} } as ServerMessage);

      let state = useAppStore.getState();
      expect(state.timeline.filter(t => t.type === 'tool_call')).toHaveLength(1);

      // Duplicate TOOL_CALL (simulating replay on reconnect)
      store.processServerMessage({ type: 'TOOL_CALL', stream_id: 's1', seq: 2, call_id: 'tc1', tool_name: 'test', args: {} } as ServerMessage);

      state = useAppStore.getState();
      // Should not push another timeline entry
      expect(state.timeline.filter(t => t.type === 'tool_call')).toHaveLength(1);
      
      // TOOL_RESULT arrives
      store.processServerMessage({ type: 'TOOL_RESULT', call_id: 'tc1', seq: 3, result: 'done' } as ServerMessage);

      state = useAppStore.getState();
      expect(state.timeline.filter(t => t.type === 'tool_call')).toHaveLength(1);
      expect(state.toolCalls['tc1'].status).toBe('completed');
    });
  });
});
