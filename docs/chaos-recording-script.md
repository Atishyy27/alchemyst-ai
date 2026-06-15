# Chaos Mode Recording Script

**Target Duration:** 3–5 minutes
**Objective:** Record visual evidence of the application seamlessly handling all 5 required chaos scenarios.

## Preparation
1. Start the backend Docker container in chaos mode.
2. Run `npm run dev` and open `http://localhost:3000`.
3. Open browser Developer Tools (Console tab visible) to capture debug logs.
4. Begin screen recording.

---

## The Script

### 0:00–0:15 | Introduction
- Show the terminal confirming chaos mode and the dev server are running.
- Show the browser window at `localhost:3000` with the Console panel open.

### 0:15–1:00 | Scenario 1: Connection Drop Mid-Stream
- **Action:** Send a prompt that requires a long, descriptive response (e.g., "Write a detailed 5-paragraph essay about the history of artificial intelligence").
- **Visual Cue:** While the tokens are streaming in, watch for the connection drop. The `ConnectionStatusBanner` ("Reconnecting...") will drop down from the top. The stream will pause. Upon successful reconnection, the banner will vanish, and the token stream will immediately resume *exactly* where it left off, with no duplicated or dropped words.
- **Fallback:** *If a drop is not observed within 60s, restart the chaos container and continue.*

### 1:00–1:45 | Scenario 2: Out-of-Order Tokens
- **Action:** Send another medium-length prompt.
- **Visual Cue:** The chaos server will intentionally scramble the delivery order of `TOKEN` messages. The visual cue is the text appearing smoothly and correctly in the ChatPanel without any scrambling, gaps, or out-of-order characters. In the console, you may briefly see debug logs indicating out-of-order packets being buffered and released by the `SeqBuffer`.
- **Fallback:** *If not observed within 60s, restart the chaos container and continue.*

### 1:45–2:30 | Scenario 3: Rapid Tool Calls
- **Action:** Send a prompt that requires multiple sequential or parallel tool calls (e.g., "Search for the weather in Tokyo, London, and New York").
- **Visual Cue:** Multiple ToolCallCards will appear in the timeline. If the connection drops while they are pending, their status will briefly change to "Waiting for result (reconnecting...)". Once reconnected, the UI will cleanly transition them to completed via `RESUME` replays without duplicating the cards.
- **Fallback:** *If not observed within 60s, restart the chaos container and continue.*

### 2:30–3:30 | Scenario 4: Oversized Context Snapshot
- **Action:** Continue a longer conversation to naturally bloat the context, or trigger a command/query that forces the server to push a 500KB+ `CONTEXT_SNAPSHOT`. Immediately send a new chat message to start a token stream while the snapshot is delivered.
- **Visual Cue:** The ContextPanel will receive the large state object. Due to lazy expansion, large child nodes in the `JsonTree` will render initially collapsed. Pay close attention to the token stream in the ChatPanel — it must remain completely smooth with 0 noticeable UI freeze or layout shift while the snapshot renders.
- **Fallback:** *If not observed within 60s, restart the chaos container and continue.*

### 3:30–4:15 | Scenario 5: Corrupt Heartbeat
- **Action:** Leave the application idle for a few moments, or just monitor the browser console during normal usage.
- **Visual Cue:** The chaos server periodically sends `PING` frames with empty (corrupt) challenge strings. The UI will not show any disconnect or disruption. In the browser console, look for the log: `⚠ Corrupt PING (empty challenge) — responding anyway`. 
- **Fallback:** *If not observed within 60s, restart the chaos container and continue.*

### 4:15–4:30 | Outro & Verification
- **Action:** Open a new tab and navigate to `http://localhost:4747/log`.
- **Visual Cue:** Briefly scroll through the JSON to show that `protocol-violation` entries related to `TOOL_ACK` or missing `PONG` responses are zero, confirming the client successfully masked the chaos at the network layer.
- Stop recording.
