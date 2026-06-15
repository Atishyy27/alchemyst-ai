# DECISIONS

## Seq Ordering & Deduplication
- **SeqBuffer** uses binary search (`O(log N)`) to insert out-of-order messages into a queue.
- Duplicate sequences are silently dropped using an internal `Set<number>`.
- `popReady()` enforces strictly contiguous sequence delivery, starting from `expectedSeq`.

## Layout Shift Prevention
- Adopted a **Hierarchical Rendering** strategy for the UI:
  - `renderableTimeline` isolates the flat list of top-level messages from interleaved tool calls.
  - The `ChatMessage` component naturally incorporates tool calls inline within its segment array (`text` → `tool_call` → `text`), grouping them logically and visually inside the assistant's message bubble without breaking the feed or doubling UI items.

## Reconnection State Recovery
- **ConnectionManager** uses exponential backoff with jitter on `WS_CLOSE` or `WS_ERROR`.
- Upon successful reconnection, the client sends a `RESUME` message populated with `lastDeliveredSeq`. The server then transparently replays any missed events.

## Scaling to 50 Concurrent Streams
- **Application Store (Zustand)** normalizes state using dictionary-based lookups. `streams`, `toolCalls`, and `contexts` are stored as `Record<string, T>`, ensuring $O(1)$ operations even when receiving rapid updates across dozens of concurrent streams.

## Scaling to 100x Longer Responses
- **Derived Stream Status**: Instead of recalculating or guessing a stream's "streaming" status globally, the UI derives the stream state lazily using `selectDerivedStreamStatus`.
- Text appending directly concatenates the string inside `StreamState.segments`, avoiding deep un-memoized object copies on every token.

## Protocol Failure Modes
- **Protocol Failures & Idempotency**:
  - `ConnectionManager` caches protocol-critical outbound messages (like `TOOL_ACK` and `PONG`) in a `pendingOutbound` FIFO queue if offline, flushing them exactly once upon `RESUME`.
  - To defend against chaos-mode replays where `TOOL_CALL` arrives multiple times, the store actively enforces idempotency by ignoring a `TOOL_CALL` if `toolCalls[msg.call_id]` exists.
  - The store considers a stream `isComplete: true` upon `STREAM_END`. If `STREAM_END` arrives before unresolved tool calls finish (e.g. server fault), `isComplete` safely aborts the generation logic so the UI doesn't hang forever.
