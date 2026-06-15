// ─────────────────────────────────────────────────────────────
// ConnectionManager — WebSocket lifecycle + message pipeline.
//
// ARCHITECTURE
// ────────────
// This class is a pure infrastructure layer with zero React or
// UI coupling.  It composes the lower-level primitives built in
// earlier phases into a single cohesive API:
//
//   ┌──────────────────────────────────────────────────────┐
//   │                  ConnectionManager                   │
//   │                                                      │
//   │  ┌────────────┐  ┌────────────────┐  ┌───────────┐  │
//   │  │  WebSocket  │→│ protocolSchemas │→│  SeqBuffer │  │
//   │  │  (native)   │  │  (Zod validate) │  │ (reorder  │  │
//   │  │             │  │                 │  │  + dedup) │  │
//   │  └────────────┘  └────────────────┘  └───────────┘  │
//   │         ↕                                    ↓       │
//   │  ┌──────────────┐                ┌──────────────┐   │
//   │  │ Connection   │                │  Subscribers  │   │
//   │  │ StateMachine │                │  (message +   │   │
//   │  │              │                │   state)      │   │
//   │  └──────────────┘                └──────────────┘   │
//   └──────────────────────────────────────────────────────┘
//
// MESSAGE FLOW (inbound)
//   ws.onmessage
//     → JSON.parse
//     → parseIncomingMessage (Zod validation)
//     → PING?  handlePing (auto-reply PONG, detect corrupt)
//     → seqBuffer.add
//     → seqBuffer.popReady
//     → notify message subscribers (in seq order)
//
// HEARTBEAT / CORRUPT PING HANDLING
//   The server sends PING with a `challenge` string every ~12s.
//   The client must reply PONG echoing the exact challenge within
//   3 seconds. In chaos mode, the server may send a "corrupt"
//   PING with an empty challenge string.
//
//   RATIONALE FOR GRACEFUL HANDLING:
//   - The protocol spec says "respond to PING with PONG echoing
//     the challenge". An empty challenge is still a valid string.
//     The correct response is PONG with echo = "".
//   - If we refused to reply to corrupt PINGs, the server would
//     log a PONG_TIMEOUT violation after 3s and eventually
//     terminate the connection after 3 missed PONGs.
//   - A corrupt challenge is not a security threat — it's a
//     chaos-mode test of client resilience. Crashing or refusing
//     to respond is the wrong behaviour.
//   - We emit a DEBUG_EVENT so the UI/tests can observe the
//     anomaly without disrupting the protocol flow.
//
// MESSAGE FLOW (outbound)
//   send(ClientMessage)
//     → parseOutgoingMessage (Zod validation)
//     → JSON.stringify
//     → ws.send
//
// RECONNECTION
//   On unexpected close/error the state machine transitions to
//   'reconnecting'. A retry loop with exponential backoff
//   attempts to re-establish the connection. On success, a
//   RESUME message is sent with the last processed seq so the
//   server replays missed events.
//
// SUBSCRIBER PATTERN
//   Both onMessage and onStateChange return an unsubscribe
//   function. Multiple subscribers are supported.  Cleanup is
//   automatic when disconnect() is called.
// ─────────────────────────────────────────────────────────────

import type {
  ServerMessage,
  ClientMessage,
  PongMessage,
  ResumeMessage,
} from '@/types/protocol';

import type {
  ConnectionState,
  ConnectionEvent,
} from '@/types/stateMachine';

import { connectionTransition } from '@/types/stateMachine';
import { parseIncomingMessage, parseOutgoingMessage } from './protocolSchemas';
import { SeqBuffer } from './seqBuffer';

// ── Subscriber callback types ─────────────────────────────────

export type MessageHandler = (message: ServerMessage) => void;
export type StateChangeHandler = (
  newState: ConnectionState,
  previousState: ConnectionState,
) => void;
export type DebugEventHandler = (event: DebugEvent) => void;

/** Function returned by on* methods to remove the subscription. */
export type Unsubscribe = () => void;

// ── Debug / trace events ──────────────────────────────────────

/**
 * Structured trace events for observability.
 * These are NOT protocol messages — they are internal diagnostics
 * emitted by ConnectionManager for debugging, testing, and UI
 * status indicators.
 */
export type DebugEvent =
  | { readonly kind: 'heartbeat_sent'; readonly challenge: string; readonly corrupt: boolean; readonly timestamp: number }
  | { readonly kind: 'heartbeat_received'; readonly challenge: string; readonly corrupt: boolean; readonly seq: number; readonly timestamp: number }
  | { readonly kind: 'validation_error'; readonly direction: 'inbound' | 'outbound'; readonly error: string; readonly timestamp: number }
  | { readonly kind: 'state_transition'; readonly from: ConnectionState; readonly to: ConnectionState; readonly event: string; readonly timestamp: number }
  | { readonly kind: 'resume_sent'; readonly last_seq: number; readonly timestamp: number }
  | { readonly kind: 'message_dropped'; readonly reason: string; readonly timestamp: number };

// ── Configuration ─────────────────────────────────────────────

export interface ConnectionManagerConfig {
  /** WebSocket URL. Defaults to NEXT_PUBLIC_WS_URL or ws://localhost:4747/ws. */
  readonly url?: string;

  /** Maximum reconnect attempts before giving up. Default: 5. */
  readonly maxRetries?: number;

  /** Base delay (ms) for exponential backoff. Default: 1000. */
  readonly baseRetryDelayMs?: number;

  /** Maximum backoff delay (ms). Default: 30000. */
  readonly maxRetryDelayMs?: number;

  /** Enable console logging of state transitions and messages. Default: false. */
  readonly debug?: boolean;
}

// ── Defaults ──────────────────────────────────────────────────

const DEFAULT_URL = 'ws://localhost:4747/ws';
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

// ═══════════════════════════════════════════════════════════════

export class ConnectionManager {
  // ── Config ──────────────────────────────────────────────
  private readonly url: string;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly debug: boolean;

  // ── WebSocket ───────────────────────────────────────────
  private ws: WebSocket | null = null;

  // ── State machine ───────────────────────────────────────
  private state: ConnectionState = 'idle';

  // ── Seq buffer ──────────────────────────────────────────
  private readonly seqBuffer = new SeqBuffer();

  // ── Delivery tracking ───────────────────────────────────
  //
  // RECEIVED ≠ PROCESSED
  // ─────────────────────
  // A message passes through multiple stages:
  //
  //   1. RECEIVED   — ws.onmessage fires, raw bytes arrive
  //   2. VALIDATED  — Zod confirms it's a valid ServerMessage
  //   3. BUFFERED   — SeqBuffer stores it (dedup + reorder)
  //   4. RELEASED   — SeqBuffer.popReady() returns it (gap filled)
  //   5. DELIVERED  — notifyMessageHandlers() runs for all subscribers
  //
  // Only stage 5 counts as "processed". This distinction is
  // critical for RESUME-based recovery:
  //
  //   - If we tracked RECEIVED seq, a reconnect RESUME would
  //     tell the server "I have seq 10" when we actually only
  //     delivered 1–7 to the UI (because 8–10 were buffered,
  //     waiting for a gap at seq 8). The server would skip
  //     replaying 8–10, and the user would see a gap.
  //
  //   - If we tracked RELEASED (SeqBuffer.popReady), a crash
  //     between pop and delivery would lose messages: popped
  //     from the buffer but never shown to the user.
  //
  //   - By tracking DELIVERED, the RESUME last_seq accurately
  //     reflects what the application actually consumed. The
  //     server replays everything after that, and SeqBuffer's
  //     deduplication drops any overlapping messages.
  //
  // This is the same principle as consumer-offset tracking in
  // message queues (e.g. Kafka): commit offset AFTER processing,
  // not after receiving.
  //
  private lastDeliveredSeq = 0;

  // ── Reconnect ───────────────────────────────────────────
  private retryCount = 0;
  private retryTimerId: ReturnType<typeof setTimeout> | null = null;

  // ── Outbound message queue ──────────────────────────────
  //
  // WHY PROTOCOL RELIABILITY REQUIRES QUEUEING
  // ──────────────────────────────────────────
  // Protocol-critical messages (TOOL_ACK, PONG) must never be lost
  // merely because the transport is temporarily unavailable.
  //
  // When the server sends a TOOL_CALL, it blocks the response
  // script with `await new Promise(...)` until a TOOL_ACK with
  // the matching call_id arrives.
  //
  // If the connection drops, retries exhaust, and the state becomes
  // 'disconnected' before the tool finishes executing:
  //   1. UI finishes async work and calls send({ type: 'TOOL_ACK' })
  //   2. send() queues the TOOL_ACK instead of throwing
  //   3. User manually clicks "Reconnect"
  //   4. ConnectionManager reconnects, sends RESUME
  //   5. Server replays events (including TOOL_CALL)
  //   6. SeqBuffer deduplicates the replayed TOOL_CALL
  //   7. flushOutboundQueue() sends the queued TOOL_ACK in FIFO order
  //   8. Server receives ACK and unblocks the response script
  //
  // The queue is only cleared on intentional disconnect() — if the
  // user deliberately closes the connection, queued messages
  // are no longer meaningful. Transport failures do not clear the queue.
  //
  private readonly pendingOutbound: ClientMessage[] = [];

  // ── Subscribers ─────────────────────────────────────────
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly stateChangeHandlers = new Set<StateChangeHandler>();
  private readonly debugEventHandlers = new Set<DebugEventHandler>();

  // ── Intentional disconnect flag ─────────────────────────
  private intentionalDisconnect = false;

  // ── Heartbeat stats (for testing / UI) ──────────────────
  private heartbeatStats = {
    totalReceived: 0,
    corruptReceived: 0,
    pongsSent: 0,
  };

  // ─────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────

  constructor(config: ConnectionManagerConfig = {}) {
    this.url = config.url
      ?? (typeof process !== 'undefined'
        ? process.env.NEXT_PUBLIC_WS_URL ?? DEFAULT_URL
        : DEFAULT_URL);
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS;
    this.maxRetryDelayMs = config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.debug = config.debug ?? false;
  }

  // ─────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────

  /**
   * Open a WebSocket connection.
   * No-op if already connecting or connected.
   */
  connect(): void {
    if (this.state === 'connecting' || this.state === 'connected') {
      this.log('connect() ignored — already', this.state);
      return;
    }

    this.intentionalDisconnect = false;
    this.transition({ type: 'CONNECT' });
    this.openSocket();
  }

  /**
   * Cleanly close the connection.
   * Cancels any pending reconnect timers.
   * Clears the outbound queue — intentional disconnect means
   * queued messages are no longer relevant.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cancelRetry();
    this.pendingOutbound.length = 0;

    if (this.ws) {
      this.ws.close(1000, 'client disconnect');
      this.ws = null;
    }

    this.transition({ type: 'DISCONNECT' });
  }

  /**
   * Send a client→server message.
   *
   * - If connected: validates via Zod and sends immediately.
   * - If connecting, reconnecting, or disconnected: validates
   *   via Zod and queues for flush after RESUME completes.
   * - If idle: throws — the connection has never been started.
   *
   * @throws ZodError if the message is malformed.
   * @throws Error if in 'idle' state.
   */
  send(message: ClientMessage): void {
    // Validate early (fail-fast) regardless of connection state.
    // This catches malformed messages at queue time, not flush time.
    const validated = parseOutgoingMessage(message);

    // Only 'idle' is an invalid state for queuing.
    // If we are 'disconnected' due to maxRetries being exhausted,
    // we STILL queue the message. Why? Because long-running tools
    // might finish after transport is lost. When the user manually
    // clicks "Reconnect" later, the session will RESUME and the
    // queued TOOL_ACK must be delivered, or the server will hang forever.
    if (this.state === 'idle') {
      throw new Error(
        `Cannot send message: connection is ${this.state}`,
      );
    }

    // ── SESSION RESET ON USER_MESSAGE ───────────────────────
    //
    // The server resets its seq counter to 0 on every USER_MESSAGE
    // (server.ts:208-210):
    //
    //   this.seq = 0;
    //   this.eventHistory = [];
    //
    // This means the next response will start at seq=1, which
    // collides with the seq values from the previous conversation
    // turn already stored in SeqBuffer's `seen` set.
    //
    // Without this reset:
    //   1. Prompt 1 processes seq 1..24, expectedSeq becomes 25
    //   2. Prompt 2's first message arrives with seq=1
    //   3. seen.has(1) → true → silently discarded
    //   4. ALL messages for prompt 2 are lost
    //
    // We reset BEFORE sending (not after) because the server
    // processes USER_MESSAGE synchronously and begins emitting
    // seq=1 immediately. If the reset happened after ws.send(),
    // a fast server could race: its seq=1 response arrives before
    // our reset() call, gets discarded by the stale seen set,
    // and is then lost even after reset clears the set.
    //
    // Connection state is NOT affected — only the seq-tracking
    // bookkeeping is cleared.
    //
    if (validated.type === 'USER_MESSAGE') {
      this.seqBuffer.reset();
      this.lastDeliveredSeq = 0;
      this.log('Session reset: SeqBuffer cleared, lastDeliveredSeq = 0');
    }

    // ── Queue or send immediately ──────────────────────────
    if (this.state === 'connected' && this.ws) {
      this.ws.send(JSON.stringify(validated));
      this.log('→ SENT', validated.type);
    } else {
      // State is 'connecting' or 'reconnecting' — queue for later.
      this.pendingOutbound.push(validated);
      this.log('→ QUEUED', validated.type, `(${this.pendingOutbound.length} pending)`);
    }
  }

  /**
   * Subscribe to validated, seq-ordered server messages.
   * Returns an unsubscribe function.
   */
  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Subscribe to connection state changes.
   * Returns an unsubscribe function.
   */
  onStateChange(handler: StateChangeHandler): Unsubscribe {
    this.stateChangeHandlers.add(handler);
    return () => {
      this.stateChangeHandlers.delete(handler);
    };
  }

  /**
   * Subscribe to internal debug/trace events.
   * Useful for diagnostics panels, tests, and logging.
   * Returns an unsubscribe function.
   */
  onDebugEvent(handler: DebugEventHandler): Unsubscribe {
    this.debugEventHandlers.add(handler);
    return () => {
      this.debugEventHandlers.delete(handler);
    };
  }

  /** Current connection state. */
  getConnectionState(): ConnectionState {
    return this.state;
  }

  /**
   * The highest seq that was delivered to application subscribers.
   *
   * This is NOT the highest seq received or buffered — it is the
   * highest seq for which all onMessage handlers have been called.
   * Used as `last_seq` in RESUME messages after reconnection.
   *
   * See the RECEIVED ≠ PROCESSED comment block above for the
   * full rationale.
   */
  getLastProcessedSeq(): number {
    return this.lastDeliveredSeq;
  }

  /** Heartbeat statistics for testing and UI indicators. */
  getHeartbeatStats(): Readonly<typeof this.heartbeatStats> {
    return { ...this.heartbeatStats };
  }

  /** Number of outbound messages waiting to be flushed. */
  getPendingOutboundCount(): number {
    return this.pendingOutbound.length;
  }

  // ─────────────────────────────────────────────────────────
  // WebSocket lifecycle (private)
  // ─────────────────────────────────────────────────────────

  private openSocket(): void {
    this.log('Opening WebSocket →', this.url);

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.log('WebSocket OPEN');
      this.retryCount = 0;
      this.transition({ type: 'WS_OPEN' });

      // If reconnecting, send RESUME with last *delivered* seq.
      // We use lastDeliveredSeq (not SeqBuffer.getLastProcessedSeq)
      // because we only want to skip messages the application
      // actually consumed — not messages that were merely received
      // or buffered.
      const lastSeq = this.lastDeliveredSeq;
      if (lastSeq > 0) {
        this.log('Sending RESUME, last_seq =', lastSeq);
        const resume: ResumeMessage = {
          type: 'RESUME',
          last_seq: lastSeq,
        };
        ws.send(JSON.stringify(resume));
      }

      // Flush any outbound messages that were queued while
      // disconnected/reconnecting. This happens AFTER RESUME
      // so the server's replay is complete before the client
      // sends new commands (e.g. TOOL_ACK).
      this.flushOutboundQueue(ws);
    };

    ws.onmessage = (event: MessageEvent) => {
      this.handleRawMessage(event.data);
    };

    ws.onclose = (event: CloseEvent) => {
      this.log('WebSocket CLOSE', event.code, event.reason);
      this.ws = null;

      if (this.intentionalDisconnect) {
        // Already transitioned via disconnect().
        return;
      }

      this.transition({
        type: 'WS_CLOSE',
        code: event.code,
        reason: event.reason,
      });

      this.scheduleRetry();
    };

    ws.onerror = () => {
      // The error event is deliberately vague in browsers.
      // onclose always fires after onerror, so we only need
      // to handle transitioning for the case where we're
      // still in 'connecting' (first attempt failure).
      if (this.state === 'connecting') {
        this.log('WebSocket ERROR during initial connect');
        this.ws = null;
        this.transition({ type: 'WS_ERROR', error: 'connection failed' });
      }
      // For 'connected' state, let onclose handle the transition.
    };
  }

  // ─────────────────────────────────────────────────────────
  // Inbound message pipeline
  // ─────────────────────────────────────────────────────────

  private handleRawMessage(data: unknown): void {
    // Step 1: Parse JSON.
    let parsed: unknown;
    try {
      parsed = JSON.parse(data as string);
    } catch {
      this.log('Failed to parse incoming message as JSON');
      this.emitDebugEvent({
        kind: 'message_dropped',
        reason: 'JSON parse failure',
        timestamp: Date.now(),
      });
      return;
    }

    // Step 2: Validate via Zod.
    let message: ServerMessage;
    try {
      message = parseIncomingMessage(parsed);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log('Invalid incoming message:', errorMsg);
      this.emitDebugEvent({
        kind: 'validation_error',
        direction: 'inbound',
        error: errorMsg,
        timestamp: Date.now(),
      });
      return;
    }

    this.log('← RECV', message.type, 'seq =', message.seq);

    // Step 3: Auto-reply to PING.
    // This happens BEFORE the SeqBuffer so the PONG is sent
    // immediately, not delayed by gap-waiting. The 3-second
    // deadline from the server makes this ordering critical.
    if (message.type === 'PING') {
      this.handlePing(message.challenge, message.seq);
      // PING still flows through the buffer for seq tracking.
    }

    // Step 4: Route through SeqBuffer.
    // This deduplicates and reorders. It does NOT advance
    // lastDeliveredSeq — that only happens in step 5.
    this.seqBuffer.add(message);

    // Step 5: Release ordered messages and deliver to subscribers.
    // lastDeliveredSeq advances ONLY here, AFTER each message
    // is delivered to all handlers. This ensures RESUME recovery
    // replays anything that wasn't fully consumed.
    const ready = this.seqBuffer.popReady();
    for (const msg of ready) {
      this.notifyMessageHandlers(msg);
      // Advance only after successful delivery.
      this.lastDeliveredSeq = msg.seq;
    }
  }

  // ─────────────────────────────────────────────────────────
  // PING → PONG auto-response
  //
  // Handles both normal and corrupt (empty challenge) PINGs.
  // See the HEARTBEAT section in the file header for the full
  // rationale on why corrupt PINGs are handled gracefully.
  // ─────────────────────────────────────────────────────────

  private handlePing(challenge: string, seq: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const isCorrupt = challenge === '';

    // Track stats.
    this.heartbeatStats.totalReceived++;
    if (isCorrupt) {
      this.heartbeatStats.corruptReceived++;
    }

    // Emit trace event for observability.
    this.emitDebugEvent({
      kind: 'heartbeat_received',
      challenge,
      corrupt: isCorrupt,
      seq,
      timestamp: Date.now(),
    });

    if (isCorrupt) {
      this.log('⚠ Corrupt PING (empty challenge) — responding anyway');
    }

    // ALWAYS reply. The server expects a PONG for every PING,
    // regardless of whether the challenge is corrupt. Failing
    // to reply causes a PONG_TIMEOUT violation.
    const pong: PongMessage = {
      type: 'PONG',
      echo: challenge,
    };

    this.ws.send(JSON.stringify(pong));
    this.heartbeatStats.pongsSent++;

    this.emitDebugEvent({
      kind: 'heartbeat_sent',
      challenge,
      corrupt: isCorrupt,
      timestamp: Date.now(),
    });

    this.log('→ AUTO PONG, echo =', JSON.stringify(challenge));
  }

  // ─────────────────────────────────────────────────────────
  // Outbound queue flush
  // ─────────────────────────────────────────────────────────

  /**
   * Flush all queued outbound messages in FIFO order.
   *
   * Called after RESUME in ws.onopen. At this point the server
   * has replayed missed events and the connection is live.
   *
   * Ordering guarantee: messages are sent in the exact order
   * they were queued. The queue is drained completely.
   *
   * If a queued message is a USER_MESSAGE, the session-reset
   * logic fires (clearing SeqBuffer), just as it would for a
   * direct send().
   */
  private flushOutboundQueue(ws: WebSocket): void {
    if (this.pendingOutbound.length === 0) {
      return;
    }

    this.log(`Flushing ${this.pendingOutbound.length} queued outbound messages`);

    // Drain into a local copy so new send() calls during flush
    // don't interfere (e.g. if a subscriber reacts to a state
    // change and calls send() synchronously).
    const toFlush = this.pendingOutbound.splice(0, this.pendingOutbound.length);

    for (const msg of toFlush) {
      // Mirror the session-reset logic from send().
      if (msg.type === 'USER_MESSAGE') {
        this.seqBuffer.reset();
        this.lastDeliveredSeq = 0;
        this.log('Session reset (from queued USER_MESSAGE)');
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        this.log('→ FLUSHED', msg.type);
      } else {
        // Connection died again mid-flush. Re-queue remaining.
        this.pendingOutbound.push(msg);
        this.log('Connection lost mid-flush, re-queued', msg.type);
        break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Reconnection with exponential backoff
  // ─────────────────────────────────────────────────────────

  private scheduleRetry(): void {
    if (this.retryCount >= this.maxRetries) {
      this.log('Max retries exceeded');
      this.transition({ type: 'MAX_RETRIES_EXCEEDED' });
      return;
    }

    // Exponential backoff with jitter.
    const delay = Math.min(
      this.baseRetryDelayMs * Math.pow(2, this.retryCount) + Math.random() * 500,
      this.maxRetryDelayMs,
    );

    this.retryCount++;
    this.log(`Retry ${this.retryCount}/${this.maxRetries} in ${Math.round(delay)}ms`);

    this.retryTimerId = setTimeout(() => {
      this.retryTimerId = null;
      this.seqBuffer.prepareForReconnect();
      this.transition({ type: 'RETRY' });
      this.openSocket();
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
  }

  // ─────────────────────────────────────────────────────────
  // State machine driver
  // ─────────────────────────────────────────────────────────

  private transition(event: ConnectionEvent): void {
    const prev = this.state;
    const next = connectionTransition(prev, event);

    if (next === null) {
      this.log(
        `Invalid transition: ${prev} + ${event.type} → (ignored)`,
      );
      return;
    }

    this.state = next;
    this.log(`State: ${prev} → ${next} [${event.type}]`);

    this.emitDebugEvent({
      kind: 'state_transition',
      from: prev,
      to: next,
      event: event.type,
      timestamp: Date.now(),
    });

    this.notifyStateChangeHandlers(next, prev);
  }

  // ─────────────────────────────────────────────────────────
  // Subscriber notification
  // ─────────────────────────────────────────────────────────

  private notifyMessageHandlers(message: ServerMessage): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (err) {
        console.error('[ConnectionManager] message handler threw:', err);
      }
    }
  }

  private notifyStateChangeHandlers(
    newState: ConnectionState,
    prevState: ConnectionState,
  ): void {
    for (const handler of this.stateChangeHandlers) {
      try {
        handler(newState, prevState);
      } catch (err) {
        console.error('[ConnectionManager] state handler threw:', err);
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Debug event emission
  // ─────────────────────────────────────────────────────────

  private emitDebugEvent(event: DebugEvent): void {
    for (const handler of this.debugEventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[ConnectionManager] debug handler threw:', err);
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Debug logging
  // ─────────────────────────────────────────────────────────

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[ConnectionManager]', ...args);
    }
  }
}
