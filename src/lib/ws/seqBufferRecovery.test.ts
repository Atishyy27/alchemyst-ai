import { describe, it, expect, vi } from 'vitest';
import { ConnectionManager } from './connectionManager';

describe('SeqBuffer Recovery', () => {
  it('freezes when a message is dropped without reconnect', async () => {
    vi.useFakeTimers();
    
    const cm = new ConnectionManager({ url: 'ws://dummy' });
    const received: number[] = [];
    
    cm.onMessage((msg) => received.push(msg.seq));

    // Simulate connection
    // @ts-ignore
    cm.transition({ type: 'CONNECT' });
    // @ts-ignore
    cm.transition({ type: 'WS_OPEN' });
    // @ts-ignore
    cm.ws = { close: () => { cm.ws = null; cm.transition({ type: 'WS_CLOSE', code: 4000, reason: 'starvation' }); cm.scheduleRetry(); } };

    // Send 1
    // @ts-ignore
    cm.handleRawMessage(JSON.stringify({ type: 'TOKEN', stream_id: 's1', seq: 1, text: 'A' }));
    
    // Drop 2, send 3, 4, 5
    // @ts-ignore
    cm.handleRawMessage(JSON.stringify({ type: 'TOKEN', stream_id: 's1', seq: 3, text: 'C' }));
    // @ts-ignore
    cm.handleRawMessage(JSON.stringify({ type: 'TOKEN', stream_id: 's1', seq: 4, text: 'D' }));
    // @ts-ignore
    cm.handleRawMessage(JSON.stringify({ type: 'TOKEN', stream_id: 's1', seq: 5, text: 'E' }));

    expect(received).toEqual([1]);

    // Fast-forward starvation timeout (5s) + retry delay
    vi.advanceTimersByTime(5500);
    
    // The connection should have closed (due to starvation) and transitioned to reconnecting
    expect(cm.getConnectionState()).toBe('reconnecting');
    
    vi.useRealTimers();
  });
});
