import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './appStore';
import { selectRenderableChatFeed } from './chatSelectors';
import { ConnectionManager } from '../ws/connectionManager';
import type { ServerMessage } from '@/types/protocol';

describe('Streaming Fidelity Audit', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('1. TOKEN -> TOKEN -> TOOL_CALL -> TOOL_RESULT -> TOKEN sequence', () => {
    const store = useAppStore.getState();
    const sid = 'test1';
    
    // Simulate ConnectionManager enforcing order
    const feed = [
      { type: 'TOKEN', stream_id: sid, seq: 1, text: 'The answer is ' } as ServerMessage,
      { type: 'TOKEN', stream_id: sid, seq: 2, text: 'calculating...' } as ServerMessage,
      { type: 'TOOL_CALL', stream_id: sid, seq: 3, call_id: 'c1', tool_name: 'calc', args: {} } as ServerMessage,
      { type: 'TOOL_RESULT', stream_id: sid, seq: 4, call_id: 'c1', result: { value: 42 } } as ServerMessage,
      { type: 'TOKEN', stream_id: sid, seq: 5, text: ' it is 42.' } as ServerMessage,
    ];

    feed.forEach(msg => store.processServerMessage(msg));

    const chat = selectRenderableChatFeed(useAppStore.getState());
    expect(chat).toHaveLength(1);
    const items = chat[0].items;

    // Expected: 1 text block, 1 tool block, 1 text block
    expect(items).toHaveLength(3);
    
    if (items[0].kind === 'text') {
      expect(items[0].content).toBe('The answer is calculating...');
    } else {
      expect.fail('Expected text segment');
    }

    expect(items[1].kind).toBe('tool_call');
    if (items[1].kind === 'tool_call') {
      expect(items[1].status).toBe('completed');
    }

    if (items[2].kind === 'text') {
      expect(items[2].content).toBe(' it is 42.');
    } else {
      expect.fail('Expected text segment');
    }
  });

  it('2. Multiple TOOL_CALL sequence in same stream', () => {
    const store = useAppStore.getState();
    const sid = 'test2';
    
    const feed = [
      { type: 'TOKEN', stream_id: sid, seq: 1, text: 'Wait ' } as ServerMessage,
      { type: 'TOOL_CALL', stream_id: sid, seq: 2, call_id: 'c1', tool_name: 't1', args: {} } as ServerMessage,
      { type: 'TOKEN', stream_id: sid, seq: 3, text: 'and ' } as ServerMessage,
      { type: 'TOOL_CALL', stream_id: sid, seq: 4, call_id: 'c2', tool_name: 't2', args: {} } as ServerMessage,
    ];

    feed.forEach(msg => store.processServerMessage(msg));

    const chat = selectRenderableChatFeed(useAppStore.getState());
    const items = chat[0].items;

    expect(items).toHaveLength(4);
    expect(items[0].kind).toBe('text');
    expect(items[1].kind).toBe('tool_call');
    expect(items[2].kind).toBe('text');
    expect(items[3].kind).toBe('tool_call');
  });

  it('3. Replay sequence (idempotence verification)', () => {
    const store = useAppStore.getState();
    const sid = 'test3';
    
    const feed = [
      { type: 'TOKEN', stream_id: sid, seq: 1, text: 'A' } as ServerMessage,
      { type: 'TOKEN', stream_id: sid, seq: 2, text: 'B' } as ServerMessage,
    ];

    feed.forEach(msg => store.processServerMessage(msg));
    // Simulate replay of identical messages
    feed.forEach(msg => store.processServerMessage(msg));

    const chat = selectRenderableChatFeed(useAppStore.getState());
    const items = chat[0].items;

    expect(items).toHaveLength(1);
    if (items[0].kind === 'text') {
      expect(items[0].content).toBe('AB'); // NOT ABAB
    } else {
      expect.fail('Expected text segment');
    }
  });

  it('4. Out-of-order sequence via ConnectionManager', () => {
    // Tests that ConnectionManager's SeqBuffer handles out-of-order strictly
    const cm = new ConnectionManager({ url: 'ws://dummy' });
    const messagesReceived: ServerMessage[] = [];
    cm.onMessage((msg) => messagesReceived.push(msg));

    const sid = 'test4';
    
    // Send 3 then 1 then 2
    cm['handleRawMessage'](JSON.stringify({ type: 'TOKEN', stream_id: sid, seq: 3, text: 'C' }));
    cm['handleRawMessage'](JSON.stringify({ type: 'TOKEN', stream_id: sid, seq: 1, text: 'A' }));
    cm['handleRawMessage'](JSON.stringify({ type: 'TOKEN', stream_id: sid, seq: 2, text: 'B' }));

    expect(messagesReceived).toHaveLength(3);
    expect(messagesReceived[0].seq).toBe(1);
    expect(messagesReceived[1].seq).toBe(2);
    expect(messagesReceived[2].seq).toBe(3);
  });

  it('5. Reconnect mid stream', () => {
    const cm = new ConnectionManager({ url: 'ws://dummy' });
    const messagesReceived: ServerMessage[] = [];
    cm.onMessage((msg) => messagesReceived.push(msg));

    const sid = 'test5';
    
    // Original connect
    cm['handleRawMessage'](JSON.stringify({ type: 'TOKEN', stream_id: sid, seq: 1, text: 'H' }));
    cm['handleRawMessage'](JSON.stringify({ type: 'TOKEN', stream_id: sid, seq: 2, text: 'i' }));
    
    // Disconnect simulated...
    // Reconnect simulated. prepareForReconnect is called.
    // @ts-ignore - access private
    cm.seqBuffer.prepareForReconnect();

    // Replay receives [1, 2, 3]
    cm['handleRawMessage'](JSON.stringify({ type: 'TOKEN', stream_id: sid, seq: 1, text: 'H' }));
    cm['handleRawMessage'](JSON.stringify({ type: 'TOKEN', stream_id: sid, seq: 2, text: 'i' }));
    cm['handleRawMessage'](JSON.stringify({ type: 'TOKEN', stream_id: sid, seq: 3, text: '!' }));

    // Expect to only have dispatched 3 messages TOTAL
    expect(messagesReceived).toHaveLength(3);
    expect(messagesReceived[2].seq).toBe(3);
    expect((messagesReceived[2] as any).text).toBe('!');
  });

  it('6. Long stream stress test', () => {
    const store = useAppStore.getState();
    const sid = 'test6';
    
    for (let i = 1; i <= 1000; i++) {
      store.processServerMessage({ type: 'TOKEN', stream_id: sid, seq: i, text: 'A' } as ServerMessage);
    }

    const chat = selectRenderableChatFeed(useAppStore.getState());
    const items = chat[0].items;

    expect(items).toHaveLength(1);
    if (items[0].kind === 'text') {
      expect(items[0].content).toHaveLength(1000);
      expect(items[0].content).toBe('A'.repeat(1000));
    }
  });
});
