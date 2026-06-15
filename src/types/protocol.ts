// ─────────────────────────────────────────────────────────────
// Protocol type definitions for the Agent Server WebSocket API
//
// These mirror the canonical server types in agent-server/src/types.ts
// but are defined independently so the frontend has zero import
// coupling to the server codebase.
//
// Discriminant field: `type`
// Every server→client message carries a monotonically-increasing `seq`.
// ─────────────────────────────────────────────────────────────

// ── Server → Client Messages ──────────────────────────────────

/**
 * TOKEN — a single text fragment in a streaming response.
 *
 * Tokens arrive in `seq` order within a `stream_id`. The client must
 * append `text` to the current stream buffer and handle out-of-order
 * delivery (chaos mode) by sorting on `seq` before rendering.
 */
export interface TokenMessage {
  readonly type: 'TOKEN';
  readonly seq: number;
  readonly text: string;
  readonly stream_id: string;
}

/**
 * TOOL_CALL — the agent is invoking a tool mid-stream.
 *
 * The client must render a tool-call card and respond with a TOOL_ACK
 * echoing the `call_id`. The server logs a violation if the ACK is
 * missing or late.
 */
export interface ToolCallMessage {
  readonly type: 'TOOL_CALL';
  readonly seq: number;
  readonly call_id: string;
  readonly tool_name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly stream_id: string;
}

/**
 * TOOL_RESULT — the result of a previously-announced TOOL_CALL.
 *
 * Arrives after the corresponding TOOL_CALL (identified by `call_id`).
 * The client should update the tool-call card with the result data.
 */
export interface ToolResultMessage {
  readonly type: 'TOOL_RESULT';
  readonly seq: number;
  readonly call_id: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly stream_id: string;
}

/**
 * CONTEXT_SNAPSHOT — a point-in-time dump of agent context.
 *
 * May be very large (500 KB+ in the "schema/database/large" script).
 * The client should display or summarise the context in a dedicated
 * panel without blocking the token stream.
 */
export interface ContextSnapshotMessage {
  readonly type: 'CONTEXT_SNAPSHOT';
  readonly seq: number;
  readonly context_id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * PING — server heartbeat challenge.
 *
 * The client MUST respond with a PONG message echoing the `challenge`
 * string within 3 seconds, or the server logs a protocol violation.
 * In chaos mode the `challenge` field may be empty (corrupt heartbeat).
 */
export interface PingMessage {
  readonly type: 'PING';
  readonly seq: number;
  readonly challenge: string;
}

/**
 * STREAM_END — signals that a response stream is complete.
 *
 * After receiving this, no more TOKEN messages will arrive for the
 * given `stream_id`. The client should finalise the rendered response.
 */
export interface StreamEndMessage {
  readonly type: 'STREAM_END';
  readonly seq: number;
  readonly stream_id: string;
}

/**
 * ERROR — a protocol or application error from the server.
 *
 * `code` is a machine-readable error identifier;
 * `message` is a human-readable description.
 */
export interface ErrorMessage {
  readonly type: 'ERROR';
  readonly seq: number;
  readonly code: string;
  readonly message: string;
}

/**
 * Discriminated union of all server→client messages.
 * Switch on `msg.type` for exhaustive handling.
 */
export type ServerMessage =
  | TokenMessage
  | ToolCallMessage
  | ToolResultMessage
  | ContextSnapshotMessage
  | PingMessage
  | StreamEndMessage
  | ErrorMessage;

// ── Client → Server Messages ──────────────────────────────────

/**
 * USER_MESSAGE — user sends a text prompt to the agent.
 *
 * The `content` string is matched against trigger keywords on the
 * server to select a response script (e.g. "hello" → greeting,
 * "report" → report summary with tool calls).
 */
export interface UserMessage {
  readonly type: 'USER_MESSAGE';
  readonly content: string;
}

/**
 * PONG — response to a server PING heartbeat.
 *
 * `echo` MUST contain the exact `challenge` string from the
 * corresponding PING. Must be sent within 3 seconds.
 */
export interface PongMessage {
  readonly type: 'PONG';
  readonly echo: string;
}

/**
 * RESUME — reconnection handshake.
 *
 * Sent immediately after re-opening the WebSocket. `last_seq` is the
 * highest `seq` the client successfully processed before the
 * connection dropped. The server replays all events with seq > last_seq.
 */
export interface ResumeMessage {
  readonly type: 'RESUME';
  readonly last_seq: number;
}

/**
 * TOOL_ACK — acknowledgement that the client rendered a tool-call card.
 *
 * `call_id` must match the `call_id` from the TOOL_CALL message.
 * The server logs a violation if this ACK is never received.
 */
export interface ToolAckMessage {
  readonly type: 'TOOL_ACK';
  readonly call_id: string;
}

/**
 * Discriminated union of all client→server messages.
 */
export type ClientMessage =
  | UserMessage
  | PongMessage
  | ResumeMessage
  | ToolAckMessage;

// ── Utility Types ─────────────────────────────────────────────

/** Extract the `type` string literal from any protocol message. */
export type ServerMessageType = ServerMessage['type'];
export type ClientMessageType = ClientMessage['type'];

/** Lookup a specific server message by its type discriminant. */
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

/** Lookup a specific client message by its type discriminant. */
export type ClientMessageOf<T extends ClientMessageType> = Extract<ClientMessage, { type: T }>;
