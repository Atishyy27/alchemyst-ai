// ─────────────────────────────────────────────────────────────
// 5.5 — Heartbeat resilience across reconnect
//
// Test: while connected, a PING arrives; simulate disconnect+reconnect;
// assert no duplicate/unexpected PONGs are sent, and heartbeatStats
// resets cleanly.
// ─────────────────────────────────────────────────────────────

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

  simulateClose(code = 1006, reason = 'abnormal') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason } as any);
  }

  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) } as any);
  }
}

describe('Heartbeat resilience across reconnect', () => {
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

  it('resets heartbeatStats and prevents stale PONGs after reconnect', () => {
    const cm = new ConnectionManager({
      url: 'ws://test/ws',
      baseRetryDelayMs: 500,
    });

    // 1. Connect
    cm.connect();
    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();

    // 2. Receive PING
    ws1.simulateMessage({ type: 'PING', seq: 1, challenge: 'ch1' });

    // Verify PONG was sent and stats updated
    const pongs1 = ws1.sent.filter(msg => JSON.parse(msg).type === 'PONG');
    expect(pongs1.length).toBe(1);
    expect(JSON.parse(pongs1[0]).echo).toBe('ch1');
    expect(cm.getHeartbeatStats().totalReceived).toBe(1);
    expect(cm.getHeartbeatStats().pongsSent).toBe(1);

    // 3. Simulate disconnect before next PING
    ws1.simulateClose();

    // 4. Trigger reconnect
    vi.advanceTimersByTime(500);
    expect(MockWebSocket.instances.length).toBe(2);
    const ws2 = MockWebSocket.instances[1];
    ws2.simulateOpen();

    // 5. Verify stats reset cleanly upon reconnect
    const statsAfterReconnect = cm.getHeartbeatStats();
    expect(statsAfterReconnect.totalReceived).toBe(0);
    expect(statsAfterReconnect.corruptReceived).toBe(0);
    expect(statsAfterReconnect.pongsSent).toBe(0);

    // 6. Advance timer significantly to ensure no stale pre-disconnect timer fires
    vi.advanceTimersByTime(10000);

    // Verify no unexpected PONGs sent on ws2
    const pongs2 = ws2.sent.filter(msg => JSON.parse(msg).type === 'PONG');
    expect(pongs2.length).toBe(0);
  });
});
