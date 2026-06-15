import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from './connectionManager';
import type { ClientMessage } from '@/types/protocol';

// ─────────────────────────────────────────────────────────────
// Mock WebSocket
//
// We need a controllable WebSocket stub so we can:
//   1. Capture what was sent via ws.send()
//   2. Simulate open/close/error events
//   3. Verify the order of RESUME + flushed messages
// ─────────────────────────────────────────────────────────────

interface MockWebSocket {
  onopen: (() => void) | null;
  onclose: ((event: Partial<CloseEvent>) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: Partial<MessageEvent>) => void) | null;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

let mockWsInstances: MockWebSocket[] = [];

function createMockWebSocket(): MockWebSocket {
  const ws: MockWebSocket = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    readyState: 0, // CONNECTING
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  };
  mockWsInstances.push(ws);
  return ws;
}

// Replace global WebSocket with our mock.
const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  mockWsInstances = [];
  vi.useFakeTimers();

  globalThis.WebSocket = vi.fn(() => createMockWebSocket()) as unknown as typeof WebSocket;
  // Attach static constants that ConnectionManager may reference.
  (globalThis.WebSocket as unknown as Record<string, number>).OPEN = 1;
  (globalThis.WebSocket as unknown as Record<string, number>).CLOSED = 3;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.WebSocket = OriginalWebSocket;
});

/** Helper: get the most recent mock WS instance. */
function latestWs(): MockWebSocket {
  return mockWsInstances[mockWsInstances.length - 1];
}

/** Helper: simulate the WS connection opening. */
function openConnection(ws: MockWebSocket): void {
  ws.readyState = 1; // OPEN
  ws.onopen?.();
}

/** Helper: simulate an unexpected close (chaos drop). */
function dropConnection(ws: MockWebSocket): void {
  ws.readyState = 3; // CLOSED
  ws.onclose?.({ code: 1006, reason: 'chaos drop' });
}

/** Helper: extract parsed messages from ws.send() calls. */
function sentMessages(ws: MockWebSocket): unknown[] {
  return ws.send.mock.calls.map(
    (call: unknown[]) => JSON.parse(call[0] as string) as unknown,
  );
}

// ═══════════════════════════════════════════════════════════════

describe('ConnectionManager — outbound message queue', () => {
  let cm: ConnectionManager;

  beforeEach(() => {
    cm = new ConnectionManager({ url: 'ws://test:4747/ws', debug: false });
  });

  afterEach(() => {
    // Prevent cleanup errors.
    try { cm.disconnect(); } catch { /* ignore */ }
  });

  // ─────────────────────────────────────────────────────────
  // Connected → send immediately
  // ─────────────────────────────────────────────────────────

  describe('connected → send immediately', () => {
    it('sends the message via ws.send() without queuing', () => {
      cm.connect();
      const ws = latestWs();
      openConnection(ws);

      const msg: ClientMessage = { type: 'USER_MESSAGE', content: 'hello' };
      cm.send(msg);

      expect(cm.getPendingOutboundCount()).toBe(0);

      // ws.send() was called (RESUME may not have been sent since
      // lastDeliveredSeq is 0 on first connect).
      const messages = sentMessages(ws);
      const userMsg = messages.find(
        (m) => (m as Record<string, unknown>).type === 'USER_MESSAGE',
      );
      expect(userMsg).toEqual({ type: 'USER_MESSAGE', content: 'hello' });
    });

    it('sends TOOL_ACK immediately when connected', () => {
      cm.connect();
      const ws = latestWs();
      openConnection(ws);

      cm.send({ type: 'TOOL_ACK', call_id: 'tc_1' });

      expect(cm.getPendingOutboundCount()).toBe(0);
      const messages = sentMessages(ws);
      expect(messages).toContainEqual({ type: 'TOOL_ACK', call_id: 'tc_1' });
    });
  });

  // ─────────────────────────────────────────────────────────
  // Reconnecting / Disconnected → queue
  // ─────────────────────────────────────────────────────────

  describe('reconnecting / disconnected → queue', () => {
    it('queues TOOL_ACK instead of throwing when reconnecting', () => {
      cm.connect();
      const ws1 = latestWs();
      openConnection(ws1);

      // Simulate chaos drop → state becomes 'reconnecting'.
      dropConnection(ws1);
      expect(cm.getConnectionState()).toBe('reconnecting');

      expect(() => {
        cm.send({ type: 'TOOL_ACK', call_id: 'tc_1' });
      }).not.toThrow();

      expect(cm.getPendingOutboundCount()).toBe(1);
    });

    it('queues PONG and TOOL_ACK when disconnected (max retries exceeded)', () => {
      cm.connect();
      const ws1 = latestWs();
      openConnection(ws1);

      // We don't need to actually wait for retries in the test if we can
      // just simulate the state. We'll force max retries by mocking the config.
      const cmFastFail = new ConnectionManager({ url: 'ws://test:4747/ws', maxRetries: 0 });
      cmFastFail.connect();
      const wsFastFail = latestWs();
      openConnection(wsFastFail);

      dropConnection(wsFastFail);
      expect(cmFastFail.getConnectionState()).toBe('disconnected');

      // Now we are disconnected due to transport failure.
      // UI generates a TOOL_ACK and a PONG (e.g. from a delayed tool run).
      expect(() => {
        cmFastFail.send({ type: 'TOOL_ACK', call_id: 'long_tool' });
        cmFastFail.send({ type: 'PONG', echo: 'late' });
      }).not.toThrow();

      expect(cmFastFail.getPendingOutboundCount()).toBe(2);
    });

    it('queues multiple messages preserving FIFO order', () => {
      cm.connect();
      const ws1 = latestWs();
      openConnection(ws1);

      dropConnection(ws1);

      cm.send({ type: 'TOOL_ACK', call_id: 'tc_1' });
      cm.send({ type: 'TOOL_ACK', call_id: 'tc_2' });
      cm.send({ type: 'PONG', echo: 'abc' });

      expect(cm.getPendingOutboundCount()).toBe(3);
    });

    it('still throws on idle state', () => {
      // Brand new manager — state is 'idle'.
      const freshCm = new ConnectionManager({ url: 'ws://test:4747/ws' });
      expect(freshCm.getConnectionState()).toBe('idle');
      expect(() => {
        freshCm.send({ type: 'USER_MESSAGE', content: 'hello' });
      }).toThrow(/idle/);
    });

    it('validates messages at queue time (fail-fast)', () => {
      cm.connect();
      const ws1 = latestWs();
      openConnection(ws1);
      dropConnection(ws1);

      // A malformed message should throw ZodError even when queuing.
      expect(() => {
        // Missing `content` field on USER_MESSAGE.
        cm.send({ type: 'USER_MESSAGE' } as unknown as ClientMessage);
      }).toThrow();

      // Nothing was queued because validation failed.
      expect(cm.getPendingOutboundCount()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Reconnected → flush
  //
  // The flush sequence must be:
  //   1. RESUME (with last_seq)
  //   2. Queued messages in FIFO order
  //
  // This ordering is critical because the server replays events
  // AFTER receiving RESUME. The queued TOOL_ACK must arrive after
  // the server has replayed the corresponding TOOL_CALL.
  // ─────────────────────────────────────────────────────────

  describe('reconnected → flush', () => {
    it('flushes queued messages after RESUME on reconnect', () => {
      cm.connect();
      const ws1 = latestWs();
      openConnection(ws1);

      // Simulate receiving a message so lastDeliveredSeq > 0.
      ws1.onmessage?.({
        data: JSON.stringify({ type: 'TOKEN', seq: 1, text: 'hi', stream_id: 's1' }),
      });

      // Connection drops.
      dropConnection(ws1);

      // Queue a TOOL_ACK while disconnected.
      cm.send({ type: 'TOOL_ACK', call_id: 'tc_1' });
      expect(cm.getPendingOutboundCount()).toBe(1);

      // Advance past the retry delay to trigger reconnect.
      vi.advanceTimersByTime(2000);

      // New WebSocket opens.
      const ws2 = latestWs();
      expect(ws2).not.toBe(ws1);
      openConnection(ws2);

      // Queue should be flushed.
      expect(cm.getPendingOutboundCount()).toBe(0);

      // Verify the order: RESUME first, then TOOL_ACK.
      const messages = sentMessages(ws2);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ type: 'RESUME', last_seq: 1 });
      expect(messages[1]).toEqual({ type: 'TOOL_ACK', call_id: 'tc_1' });
    });

    it('flushes multiple messages in FIFO order', () => {
      cm.connect();
      const ws1 = latestWs();
      openConnection(ws1);

      // Receive a message to set lastDeliveredSeq.
      ws1.onmessage?.({
        data: JSON.stringify({ type: 'TOKEN', seq: 1, text: 'a', stream_id: 's1' }),
      });

      dropConnection(ws1);

      // Queue three messages.
      cm.send({ type: 'TOOL_ACK', call_id: 'tc_1' });
      cm.send({ type: 'TOOL_ACK', call_id: 'tc_2' });
      cm.send({ type: 'PONG', echo: 'challenge_x' });

      vi.advanceTimersByTime(2000);
      const ws2 = latestWs();
      openConnection(ws2);

      const messages = sentMessages(ws2);
      // RESUME + 3 queued = 4 total
      expect(messages).toHaveLength(4);
      expect((messages[0] as Record<string, unknown>).type).toBe('RESUME');
      expect((messages[1] as Record<string, unknown>).type).toBe('TOOL_ACK');
      expect((messages[1] as Record<string, unknown>).call_id).toBe('tc_1');
      expect((messages[2] as Record<string, unknown>).call_id).toBe('tc_2');
      expect((messages[3] as Record<string, unknown>).type).toBe('PONG');
    });

    it('skips RESUME on first connect (no prior session)', () => {
      cm.connect();
      const ws = latestWs();
      openConnection(ws);

      // No RESUME should be sent (lastDeliveredSeq is 0).
      const messages = sentMessages(ws);
      const resumeMsg = messages.find(
        (m) => (m as Record<string, unknown>).type === 'RESUME',
      );
      expect(resumeMsg).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────
  // Disconnect clears the queue
  // ─────────────────────────────────────────────────────────

  describe('disconnect clears queue', () => {
    it('clears pending messages on intentional disconnect', () => {
      cm.connect();
      const ws1 = latestWs();
      openConnection(ws1);
      dropConnection(ws1);

      cm.send({ type: 'TOOL_ACK', call_id: 'tc_1' });
      cm.send({ type: 'TOOL_ACK', call_id: 'tc_2' });
      expect(cm.getPendingOutboundCount()).toBe(2);

      cm.disconnect();

      expect(cm.getPendingOutboundCount()).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // TOOL_ACK reliability scenario (end-to-end)
  //
  // This test simulates the exact failure scenario from the
  // review: chaos drops the connection right after a TOOL_CALL
  // is delivered, and the UI's TOOL_ACK must survive the
  // reconnect cycle.
  // ─────────────────────────────────────────────────────────

  describe('TOOL_ACK reliability (chaos scenario)', () => {
    it('TOOL_ACK survives a connection drop mid-tool-call', () => {
      cm.connect();
      const ws1 = latestWs();
      openConnection(ws1);

      // Server sends TOOL_CALL (delivered to UI via onMessage).
      const toolCallReceived: unknown[] = [];
      cm.onMessage((msg) => {
        toolCallReceived.push(msg);
      });

      ws1.onmessage?.({
        data: JSON.stringify({
          type: 'TOOL_CALL', seq: 1,
          call_id: 'tc_1', tool_name: 'search',
          args: { query: 'Q3' }, stream_id: 's1',
        }),
      });

      expect(toolCallReceived).toHaveLength(1);
      expect(cm.getLastProcessedSeq()).toBe(1);

      // Chaos drops the connection BEFORE the UI can send TOOL_ACK.
      dropConnection(ws1);

      // UI reacts to the TOOL_CALL and sends TOOL_ACK.
      // Without the queue, this would throw and the ACK would be lost.
      cm.send({ type: 'TOOL_ACK', call_id: 'tc_1' });
      expect(cm.getPendingOutboundCount()).toBe(1);

      // Reconnect.
      vi.advanceTimersByTime(2000);
      const ws2 = latestWs();
      openConnection(ws2);

      // Verify: RESUME first, then TOOL_ACK.
      const messages = sentMessages(ws2);
      expect(messages[0]).toEqual({ type: 'RESUME', last_seq: 1 });
      expect(messages[1]).toEqual({ type: 'TOOL_ACK', call_id: 'tc_1' });
      expect(cm.getPendingOutboundCount()).toBe(0);
    });
  });
});
