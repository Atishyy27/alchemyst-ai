# Engineering Decisions

This document outlines the rationale behind the systems architecture for the Agent Console, specifically addressing protocol compliance, stream fidelity, and chaos-mode survival.

## The Event Pipeline
Data flowing from a WebSocket directly into React state is a recipe for race conditions. The architecture separates transport, ordering, and state into distinct layers:
1. **Transport**: `ConnectionManager` handles the raw WebSocket, heartbeats, and exponential backoff.
2. **Buffer**: `SeqBuffer` isolates the application from network chaos. It buffers out-of-order events, sorts them, drops duplicates, and flushes them to the store only when sequential constraints are met.
3. **State**: The `appStore` (Zustand) acts as a synchronous reducer. It takes guaranteed-ordered messages and updates the DOM representations.

### Why buffering is required
In chaos mode, the server deliberately scrambles `seq` numbers. If the DOM consumed tokens greedily as they arrived on the socket, `seq 5` arriving before `seq 3` would render scrambled text. By forcing all messages through the `SeqBuffer`, the UI is guaranteed to only ever process linear, ordered events.

### Why deduplication is required
The server sends duplicate `seq` numbers as part of its chaos profile. Additionally, aggressive reconnection logic can cause the client and server to overlap on replayed events. The `SeqBuffer` maintains a `seenSeq` Set, guaranteeing that no matter how many times the server replays a sequence, it only modifies the UI state once.

### "Received" vs. "Processed"
A critical distinction in this architecture is tracking what the socket has *received* versus what the DOM has *processed*. `lastDeliveredSeq` only increments when a message exits the `SeqBuffer` and is handled by the application layer. If a connection drops while `seq 4` and `seq 5` are buffered waiting for `seq 3`, the `RESUME` payload will request replay from `seq 2`. This guarantees no data is trapped in dead memory during a disconnect.

## The TOOL_ACK Race Condition
The protocol specification dictates that the client must send `TOOL_ACK` within 5 seconds of receiving a `TOOL_CALL`, otherwise the server times out and sends the `TOOL_RESULT` anyway.
**The Failure Mode:** If the connection drops precisely as the client sends the `TOOL_ACK`, the server might process the timeout, generate the result, and log the sequence. When the client reconnects and sends `RESUME`, the server replays the `TOOL_CALL` and immediately replays the `TOOL_RESULT`.
**The Fix:** Our implementation tracks tool calls in a dictionary keyed by `call_id`. If a replayed `TOOL_CALL` arrives for an already pending tool, it is treated idempotently. The UI card never flickers, and the subsequent `TOOL_RESULT` simply fulfills the pending state. 

## Why RESUME Uses Processed Seq Instead of Received Seq
Tracking the highest received sequence number is unsafe because a message may be received by the transport layer but never committed into application state before a disconnect.

The client therefore resumes from the highest sequence that successfully exited the ordering buffer and was consumed by the store.

This favors replaying a small overlap of events over risking permanent message loss.

## Two-Tab Reconnection Loop (4001 Close Code)
During testing, a failure mode was identified where two open tabs sharing a backend session would trigger an infinite reconnect loop, as the server aggressively closes old sockets. The client explicitly handles close code `4001` (replaced by new session) to gracefully enter a `DISCONNECT` state rather than fighting for connection supremacy.

## Context Inspector & Large Payloads
A 500KB JSON payload parsed and diffed synchronously will drop frames and lock the main thread, failing the chaos mode requirement.
We solved this by using `react-window` for the Timeline, and minimizing DOM work through lazy tree expansion and virtualized timeline rendering.

## Future Scaling
**50 Concurrent Agents:**
If scaling to an operations dashboard, hoisting the entire timeline state into a single React Context/Zustand store would bottleneck rendering. I would migrate the `ConnectionManager` and `SeqBuffer` into a Web Worker. The worker would handle protocol parsing, ordering, and diffing, only posting `requestAnimationFrame`-aligned updates back to the main thread.

**100x Longer Outputs:**
For document-scale generation, storing a monotonically increasing string of millions of tokens in memory will cause garbage collection pauses. I would implement a chunking strategy: flushing completed paragraphs into immutable blocks, keeping only the actively streaming sentence in mutable React state.
