// ─────────────────────────────────────────────────────────────
// 5.3 — Exponential backoff timing test
//
// Validates that ConnectionManager schedules reconnect retries
// with exponential backoff and caps at maxRetryDelayMs.
//
// Config under test:
//   baseRetryDelayMs: 1000, maxRetryDelayMs: 10000, maxRetries: 6
//
// Backoff formula (from connectionManager.ts L686-688):
//   delay = min(base * 2^retryCount + random()*500, max)
//
// With Math.random() mocked to 0 (zero jitter):
//   retry 0: 1000 * 2^0 = 1000
//   retry 1: 1000 * 2^1 = 2000
//   retry 2: 1000 * 2^2 = 4000
//   retry 3: 1000 * 2^3 = 8000
//   retry 4: 1000 * 2^4 = 16000 → capped to 10000
//   retry 5: 1000 * 2^5 = 32000 → capped to 10000
//
// Jitter range: [0, 500) added before cap.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from './connectionManager';

// ── MockWebSocket ────────────────────────────────────────────

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
  onerror: WsHandler = null;

  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
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

  // ── Test helpers ──
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as any);
  }

  simulateClose(code = 1006, reason = 'abnormal') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason } as any);
  }

  simulateError() {
    this.onerror?.({} as any);
  }

  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) } as any);
  }
}

// ── Tests ────────────────────────────────────────────────────

describe('ConnectionManager exponential backoff', () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let originalRandom: typeof Math.random;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];

    // Save and replace globals
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

  it('schedules retries with exponentially increasing delays, capped at max', () => {
    const cm = new ConnectionManager({
      url: 'ws://test/ws',
      baseRetryDelayMs: 1000,
      maxRetryDelayMs: 10_000,
      maxRetries: 6,
    });

    // Step 1: Connect successfully, then drop → 'reconnecting'
    cm.connect();
    const ws0 = MockWebSocket.instances[0];
    ws0.simulateOpen();
    expect(cm.getConnectionState()).toBe('connected');

    ws0.simulateClose(1006, 'abnormal');
    expect(cm.getConnectionState()).toBe('reconnecting');

    // Expected delays (zero jitter): 1000, 2000, 4000, 8000, 10000, 10000
    const expectedDelays = [1000, 2000, 4000, 8000, 10000, 10000];

    for (let i = 0; i < expectedDelays.length; i++) {
      const prevInstanceCount = MockWebSocket.instances.length;

      // Advance time just short of the expected delay — no new WS yet
      vi.advanceTimersByTime(expectedDelays[i] - 1);
      expect(MockWebSocket.instances.length).toBe(prevInstanceCount);

      // Advance the remaining 1ms — retry fires, new WS created
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances.length).toBe(prevInstanceCount + 1);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

      // Simulate the retry failing without opening:
      // onerror (from 'connecting' → 'disconnected') then onclose
      // Both paths lead to scheduleRetry() being called again in onclose.
      //
      // IMPORTANT: We must trigger onerror FIRST (as browsers do),
      // then onclose. The onerror handler only acts if state is 'connecting'.
      // The onclose handler calls scheduleRetry() unconditionally.
      ws.simulateError();
      ws.simulateClose(1006, 'connection failed');
    }
  });

  it('gives up after maxRetries and transitions to disconnected', () => {
    const cm = new ConnectionManager({
      url: 'ws://test/ws',
      baseRetryDelayMs: 1000,
      maxRetryDelayMs: 10_000,
      maxRetries: 3,
    });

    // Connect then drop
    cm.connect();
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateClose(1006, 'abnormal');
    expect(cm.getConnectionState()).toBe('reconnecting');

    // Retry 1: timer fires → new WS → fail
    vi.advanceTimersByTime(1000);
    let ws = MockWebSocket.instances[1];
    ws.simulateError();
    ws.simulateClose(1006, 'fail');

    // Retry 2
    vi.advanceTimersByTime(2000);
    ws = MockWebSocket.instances[2];
    ws.simulateError();
    ws.simulateClose(1006, 'fail');

    // Retry 3
    vi.advanceTimersByTime(4000);
    ws = MockWebSocket.instances[3];
    ws.simulateError();
    ws.simulateClose(1006, 'fail');

    // After 3 retries (maxRetries=3), the 4th scheduleRetry()
    // call sees retryCount >= maxRetries and transitions to disconnected.
    // retryCount is incremented after each scheduleRetry, so:
    //   scheduleRetry() #1: retryCount 0→1
    //   scheduleRetry() #2: retryCount 1→2
    //   scheduleRetry() #3: retryCount 2→3
    //   onclose → scheduleRetry() #4: retryCount(3) >= maxRetries(3) → MAX_RETRIES_EXCEEDED
    expect(cm.getConnectionState()).toBe('disconnected');
  });

  it('jitter adds [0, 500) to each delay (documented range)', () => {
    // Restore real random for this test
    Math.random = originalRandom;

    // Collect actual setTimeout delay values
    const capturedDelays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      (fn: any, ms?: number, ...args: any[]) => {
        if (ms !== undefined && ms >= 500) {
          capturedDelays.push(ms);
        }
        return origSetTimeout(fn, ms, ...args);
      }
    );

    const cm = new ConnectionManager({
      url: 'ws://test/ws',
      baseRetryDelayMs: 1000,
      maxRetryDelayMs: 100_000, // high cap so it doesn't interfere
      maxRetries: 5,
    });

    // Connect and drop
    cm.connect();
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateClose(1006, 'abnormal');

    // The first scheduleRetry() should have been called.
    // The setTimeout call contains the delay. Let's trigger
    // the chain for a few retries to collect multiple delays.
    for (let i = 0; i < 3; i++) {
      // Advance by a large amount to trigger the timer
      vi.advanceTimersByTime(100_000);
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      if (ws) {
        ws.simulateError();
        ws.simulateClose(1006, 'fail');
      }
    }

    // We should have captured at least 3 retry delays
    expect(capturedDelays.length).toBeGreaterThanOrEqual(3);

    // Verify jitter range: delay should be in [base*2^n, base*2^n + 500)
    // retry 0: [1000, 1500)
    expect(capturedDelays[0]).toBeGreaterThanOrEqual(1000);
    expect(capturedDelays[0]).toBeLessThan(1500);
    // retry 1: [2000, 2500)
    expect(capturedDelays[1]).toBeGreaterThanOrEqual(2000);
    expect(capturedDelays[1]).toBeLessThan(2500);
    // retry 2: [4000, 4500)
    expect(capturedDelays[2]).toBeGreaterThanOrEqual(4000);
    expect(capturedDelays[2]).toBeLessThan(4500);

    setTimeoutSpy.mockRestore();
  });
});
