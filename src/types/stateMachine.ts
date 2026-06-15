// ─────────────────────────────────────────────────────────────
// State machine type definitions for the WebSocket client.
//
// Two independent machines run concurrently:
//   1. ConnectionState — manages the WebSocket lifecycle
//   2. StreamState     — manages a single response stream
//
// A stream exists only while a connection is active. If the
// connection drops, the stream is implicitly paused and may
// resume after reconnection via the RESUME protocol.
// ─────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
// CONNECTION STATE MACHINE
// ═══════════════════════════════════════════════════════════════
//
// Mermaid diagram (copy into README.md):
//
// ```mermaid
// stateDiagram-v2
//     [*] --> idle
//
//     idle --> connecting : CONNECT
//     connecting --> connected : WS_OPEN
//     connecting --> disconnected : WS_ERROR
//     connected --> reconnecting : WS_CLOSE / WS_ERROR
//     connected --> disconnected : DISCONNECT
//     reconnecting --> connecting : RETRY
//     reconnecting --> disconnected : MAX_RETRIES_EXCEEDED
//     disconnected --> connecting : CONNECT
//     disconnected --> [*]
// ```
//
// ── Valid Transitions ─────────────────────────────────────────
//
//  From           | Event                | To             | Notes
//  ───────────────|──────────────────────|────────────────|──────────────────────────────
//  idle           | CONNECT              | connecting     | User initiates connection
//  connecting     | WS_OPEN              | connected      | WebSocket.onopen fires
//  connecting     | WS_ERROR             | disconnected   | Initial connection failed (no retry from first attempt)
//  connected      | WS_CLOSE / WS_ERROR  | reconnecting   | Unexpected drop; begin retry loop
//  connected      | DISCONNECT           | disconnected   | Clean user-initiated close
//  reconnecting   | RETRY                | connecting     | Retry timer fires, try again
//  reconnecting   | MAX_RETRIES_EXCEEDED | disconnected   | Gave up reconnecting
//  disconnected   | CONNECT              | connecting     | User explicitly reconnects
//
// ── Invalid Transitions (and why) ─────────────────────────────
//
//  idle → connected               — Must go through connecting (WS handshake is async)
//  idle → reconnecting            — Cannot reconnect without a prior connection
//  connecting → reconnecting      — First-time failures go to disconnected, not reconnecting
//                                   (reconnecting is reserved for drops from an established session)
//  connecting → idle              — Once CONNECT is dispatched, cannot return to idle
//  connected → connecting         — Must transit through reconnecting or disconnected first
//  connected → idle               — idle is the pre-first-connect state only
//  reconnecting → connected       — Must go through connecting → WS_OPEN → connected
//  reconnecting → idle            — Cannot return to idle after a session has existed
//  disconnected → connected       — Must go through connecting (WS handshake is async)
//  disconnected → reconnecting    — User action produces CONNECT, not an automatic retry
//  disconnected → idle            — idle is the initial state only; once left, never re-entered
//

/** All possible connection states. */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

/** Events that drive the connection state machine. */
export type ConnectionEvent =
  | { readonly type: 'CONNECT' }
  | { readonly type: 'WS_OPEN' }
  | { readonly type: 'WS_CLOSE'; readonly code: number; readonly reason: string }
  | { readonly type: 'WS_ERROR'; readonly error: string }
  | { readonly type: 'DISCONNECT' }
  | { readonly type: 'RETRY' }
  | { readonly type: 'MAX_RETRIES_EXCEEDED' };

/** Discriminant string union of connection event types. */
export type ConnectionEventType = ConnectionEvent['type'];

/**
 * Pure transition function for the connection state machine.
 *
 * Returns the next state, or `null` if the transition is invalid.
 * The caller decides how to handle invalid transitions (log, throw, ignore).
 */
export function connectionTransition(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState | null {
  switch (state) {
    case 'idle':
      if (event.type === 'CONNECT') return 'connecting';
      return null;

    case 'connecting':
      if (event.type === 'WS_OPEN') return 'connected';
      if (event.type === 'WS_ERROR') return 'disconnected';
      return null;

    case 'connected':
      if (event.type === 'WS_CLOSE' || event.type === 'WS_ERROR') return 'reconnecting';
      if (event.type === 'DISCONNECT') return 'disconnected';
      return null;

    case 'reconnecting':
      if (event.type === 'RETRY') return 'connecting';
      if (event.type === 'MAX_RETRIES_EXCEEDED') return 'disconnected';
      return null;

    case 'disconnected':
      if (event.type === 'CONNECT') return 'connecting';
      return null;

    default: {
      // Exhaustiveness check — if a new state is added without handling it,
      // TypeScript will error here at compile time.
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}


// ═══════════════════════════════════════════════════════════════
// STREAM STATE MACHINE
// ═══════════════════════════════════════════════════════════════
//
// Mermaid diagram (copy into README.md):
//
// ```mermaid
// stateDiagram-v2
//     [*] --> streaming
//
//     streaming --> tool_call_pending : TOOL_CALL_RECEIVED
//     streaming --> paused : CONNECTION_LOST
//     streaming --> ended : STREAM_END_RECEIVED
//
//     tool_call_pending --> streaming : TOOL_RESULT_RECEIVED
//     tool_call_pending --> paused : CONNECTION_LOST
//
//     paused --> streaming : STREAM_RESUMED
//     paused --> ended : STREAM_END_RECEIVED
//
//     ended --> [*]
// ```
//
// ── Valid Transitions ─────────────────────────────────────────
//
//  From                | Event                  | To                  | Notes
//  ────────────────────|────────────────────────|─────────────────────|──────────────────────────────
//  streaming           | TOOL_CALL_RECEIVED     | tool_call_pending   | Server sent TOOL_CALL; tokens paused until result
//  streaming           | CONNECTION_LOST        | paused              | WebSocket dropped mid-stream
//  streaming           | STREAM_END_RECEIVED    | ended               | Normal stream completion
//  tool_call_pending   | TOOL_RESULT_RECEIVED   | streaming           | Tool result arrived; tokens resume
//  tool_call_pending   | CONNECTION_LOST        | paused              | Dropped while waiting for tool result
//  paused              | STREAM_RESUMED         | streaming           | Reconnected and RESUME replayed missing events
//  paused              | STREAM_END_RECEIVED    | ended               | RESUME replay included STREAM_END
//
// ── Invalid Transitions (and why) ─────────────────────────────
//
//  streaming → streaming            — No self-transitions; TOKEN messages don't change state
//  tool_call_pending → ended        — Cannot end while a tool call is outstanding;
//                                     must receive TOOL_RESULT first (or CONNECTION_LOST → paused → ended)
//  tool_call_pending → tool_call_pending — Server sends tool calls sequentially, not concurrently
//                                          (see server.ts: it awaits ACK before continuing)
//  paused → tool_call_pending       — Resuming always returns to streaming first;
//                                     if a TOOL_CALL is in the replay buffer it's handled from streaming
//  ended → (anything)               — Terminal state; no outbound transitions
//

/** All possible stream states. */
export type StreamState =
  | 'streaming'
  | 'tool_call_pending'
  | 'paused'
  | 'ended';

/** Events that drive the stream state machine. */
export type StreamEvent =
  | { readonly type: 'TOOL_CALL_RECEIVED'; readonly call_id: string }
  | { readonly type: 'TOOL_RESULT_RECEIVED'; readonly call_id: string }
  | { readonly type: 'STREAM_END_RECEIVED' }
  | { readonly type: 'CONNECTION_LOST' }
  | { readonly type: 'STREAM_RESUMED' };

/** Discriminant string union of stream event types. */
export type StreamEventType = StreamEvent['type'];

/**
 * Pure transition function for the stream state machine.
 *
 * Returns the next state, or `null` if the transition is invalid.
 */
export function streamTransition(
  state: StreamState,
  event: StreamEvent,
): StreamState | null {
  switch (state) {
    case 'streaming':
      if (event.type === 'TOOL_CALL_RECEIVED') return 'tool_call_pending';
      if (event.type === 'CONNECTION_LOST') return 'paused';
      if (event.type === 'STREAM_END_RECEIVED') return 'ended';
      return null;

    case 'tool_call_pending':
      if (event.type === 'TOOL_RESULT_RECEIVED') return 'streaming';
      if (event.type === 'CONNECTION_LOST') return 'paused';
      return null;

    case 'paused':
      if (event.type === 'STREAM_RESUMED') return 'streaming';
      if (event.type === 'STREAM_END_RECEIVED') return 'ended';
      return null;

    case 'ended':
      // Terminal state — no valid transitions out.
      return null;

    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
