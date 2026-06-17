import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from './connectionManager';

type WsHandler = ((ev: any) => void) | null;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: WsHandler = null;
  onclose: WsHandler = null;
  onmessage: WsHandler = null;

  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' } as any);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as any);
  }

  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) } as any);
  }
}

describe('TOOL_ACK early sending', () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let originalRandom: typeof Math.random;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    originalWebSocket = globalThis.WebSocket;
    originalRandom = Math.random;
    (globalThis as any).WebSocket = MockWebSocket;
    Math.random = () => 0; // Zero jitter for deterministic delays
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    Math.random = originalRandom;
  });

  it('sends TOOL_ACK immediately when TOOL_CALL arrives, before SeqBuffer releases it', () => {
    const cm = new ConnectionManager({
      url: 'ws://test/ws',
    });

    cm.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Send a TOOL_CALL with seq:5. Since we haven't received seq 1-4,
    // this will be buffered by SeqBuffer.
    ws.simulateMessage({
      type: 'TOOL_CALL',
      seq: 5,
      call_id: 'tc_early',
      tool_name: 'test_tool',
      args: {},
      stream_id: 's1'
    });

    // The message is buffered and NOT yet processed by app logic.
    // However, the TOOL_ACK should be sent immediately.
    const acks = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'TOOL_ACK');
    
    expect(acks.length).toBe(1);
    expect(acks[0].call_id).toBe('tc_early');
    
    // Verify that the seq buffer indeed hasn't released it
    expect(cm.getLastProcessedSeq()).toBe(0);
  });
});
