# Chaos Testing Matrix

This document maps the chaos mode protocol behaviors to the application's defensive mechanisms.

| Scenario | Testing Strategy | Expected Behavior | Evidence |
| :--- | :--- | :--- | :--- |
| **Connection Drop** | Kill server process or trigger internal close. | App detects disconnect via `onclose` within 500ms. Displays non-blocking banner. Exponential backoff engages. Reconnects and sends `RESUME` with exact `last_seq`. | Trace timeline logs "WebSocket CLOSED" followed by successful "Replay". Chat UI remains interactive during outage. |
| **Out-of-order Delivery** | Server scrambles `seq` (e.g. 3, 5, 4). | `seqBuffer.ts` holds `seq 5`, waits for `seq 4`. Once `seq 4` arrives, flush `4` and `5` together. | Token text does not scramble. Timeline renders rows in correct monotonic sequence. |
| **Duplicate Messages** | Server sends `seq 12` twice. | `seqBuffer` checks `seenSeq` Set. The duplicate is instantly discarded. | No duplicate text blocks in chat. Timeline shows exactly one entry for `seq 12`. |
| **Rapid Tool Calls** | Server sends `TOOL_CALL A`, immediately followed by `TOOL_CALL B`. | `appStore` indexes by `call_id`. Both cards render independently in the DOM. | Two distinct UI cards appear with "Pending" status simultaneously. |
| **Corrupt Heartbeat** | Server sends `{"type": "PING", "challenge": ""}` | Client parses the empty string, acknowledges it is corrupt, and sends `{"type": "PONG", "echo": ""}` to satisfy server timeout. | Console logs `⚠ Corrupt PING`. Connection is preserved and not dropped by server timeout. |
| **Oversized Context** | Server sends 500KB+ JSON blob in `CONTEXT_SNAPSHOT`. | Virtualized Timeline accepts the event instantly. JsonTree lazily renders nested nodes and remains interactive for large payloads. | The main chat thread does not freeze or jitter. Scrolling remains 60fps. |
