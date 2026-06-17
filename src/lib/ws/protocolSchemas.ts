// ─────────────────────────────────────────────────────────────
// Runtime validation schemas for the WebSocket protocol.
//
// WHERE THIS BELONGS IN THE PIPELINE
// ───────────────────────────────────
// WebSocket messages are untyped at the wire level (raw strings).
// This validation layer sits at two points:
//
//   1. INBOUND (server → client):
//      ws.onmessage → JSON.parse → parseIncomingMessage() → typed handler
//      Validates that the raw JSON matches one of the ServerMessage
//      variants before the application logic ever sees it. Malformed
//      or unknown messages are rejected with a descriptive ZodError
//      rather than silently corrupting state.
//
//   2. OUTBOUND (client → server):
//      build message → parseOutgoingMessage() → JSON.stringify → ws.send
//      Validates that the message the client is about to send conforms
//      to the ClientMessage protocol. Catches programming errors
//      (e.g. missing `echo` on PONG) at the boundary before the
//      server logs a protocol violation.
//
// This creates a "trust boundary": code inside the boundary can
// rely on TypeScript's static types; code at the boundary performs
// runtime validation so the two sides stay in sync even when the
// server evolves independently.
// ─────────────────────────────────────────────────────────────

import { z } from 'zod';
import type {
  ServerMessage,
  ClientMessage,
} from '@/types/protocol';

// ═══════════════════════════════════════════════════════════════
// Server → Client message schemas
// ═══════════════════════════════════════════════════════════════

export const TokenMessageSchema = z.object({
  type: z.literal('TOKEN'),
  seq: z.number(),
  text: z.string(),
  stream_id: z.string(),
});

export const ToolCallMessageSchema = z.object({
  type: z.literal('TOOL_CALL'),
  seq: z.number(),
  call_id: z.string(),
  tool_name: z.string(),
  args: z.record(z.string(), z.unknown()),
  stream_id: z.string(),
});

export const ToolResultMessageSchema = z.object({
  type: z.literal('TOOL_RESULT'),
  seq: z.number(),
  call_id: z.string(),
  result: z.record(z.string(), z.unknown()),
  stream_id: z.string(),
});

export const ContextSnapshotMessageSchema = z.object({
  type: z.literal('CONTEXT_SNAPSHOT'),
  seq: z.number(),
  context_id: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const PingMessageSchema = z.object({
  type: z.literal('PING'),
  seq: z.number(),
  challenge: z.string().optional().default(''),
});

export const StreamEndMessageSchema = z.object({
  type: z.literal('STREAM_END'),
  seq: z.number(),
  stream_id: z.string(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal('ERROR'),
  seq: z.number(),
  code: z.string(),
  message: z.string(),
});

/**
 * Discriminated union of all server→client messages.
 * Zod picks the correct branch based on the `type` field.
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  TokenMessageSchema,
  ToolCallMessageSchema,
  ToolResultMessageSchema,
  ContextSnapshotMessageSchema,
  PingMessageSchema,
  StreamEndMessageSchema,
  ErrorMessageSchema,
]);

// ═══════════════════════════════════════════════════════════════
// Client → Server message schemas
// ═══════════════════════════════════════════════════════════════

export const UserMessageSchema = z.object({
  type: z.literal('USER_MESSAGE'),
  content: z.string(),
});

export const PongMessageSchema = z.object({
  type: z.literal('PONG'),
  echo: z.string(),
});

export const ResumeMessageSchema = z.object({
  type: z.literal('RESUME'),
  last_seq: z.number(),
});

export const ToolAckMessageSchema = z.object({
  type: z.literal('TOOL_ACK'),
  call_id: z.string(),
});

/**
 * Discriminated union of all client→server messages.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  UserMessageSchema,
  PongMessageSchema,
  ResumeMessageSchema,
  ToolAckMessageSchema,
]);

// ═══════════════════════════════════════════════════════════════
// Parse functions
// ═══════════════════════════════════════════════════════════════

/**
 * Validate and parse a raw incoming WebSocket message (server → client).
 *
 * @param raw - The value after `JSON.parse(event.data)`.
 *              Accepts `unknown` so the caller does not need to cast.
 * @returns   A fully-typed `ServerMessage`.
 * @throws    `ZodError` with a descriptive path + message on failure.
 *
 * Usage:
 * ```ts
 * ws.onmessage = (event) => {
 *   const parsed: unknown = JSON.parse(event.data);
 *   const msg = parseIncomingMessage(parsed);
 *   // msg is now ServerMessage — switch on msg.type
 * };
 * ```
 */
export function parseIncomingMessage(raw: unknown): ServerMessage {
  return ServerMessageSchema.parse(raw) as ServerMessage;
}

/**
 * Validate and parse a client message before sending (client → server).
 *
 * @param raw - The message object the client wants to send.
 * @returns   A fully-typed `ClientMessage`.
 * @throws    `ZodError` with a descriptive path + message on failure.
 *
 * Usage:
 * ```ts
 * const msg = parseOutgoingMessage({ type: 'PONG', echo: challenge });
 * ws.send(JSON.stringify(msg));
 * ```
 */
export function parseOutgoingMessage(raw: unknown): ClientMessage {
  return ClientMessageSchema.parse(raw) as ClientMessage;
}

// ═══════════════════════════════════════════════════════════════
// Safe (non-throwing) variants
// ═══════════════════════════════════════════════════════════════

/** Result type for safe parsing — avoids exposing ZodError internals. */
export type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

/**
 * Non-throwing version of `parseIncomingMessage`.
 * Returns a discriminated result instead of throwing.
 */
export function safeParseIncomingMessage(raw: unknown): ParseResult<ServerMessage> {
  const result = ServerMessageSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data as ServerMessage };
  }
  return {
    success: false,
    error: result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  };
}

/**
 * Non-throwing version of `parseOutgoingMessage`.
 * Returns a discriminated result instead of throwing.
 */
export function safeParseOutgoingMessage(raw: unknown): ParseResult<ClientMessage> {
  const result = ClientMessageSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data as ClientMessage };
  }
  return {
    success: false,
    error: result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  };
}
