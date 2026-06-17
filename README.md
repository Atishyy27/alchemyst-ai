# Agent Console

An enterprise-grade Next.js application designed to interface with context-aware AI agents over WebSockets. This project focuses strictly on **systems resilience**, providing flawless streaming fidelity and state recovery under hostile network conditions.

## Architectural Summary
The frontend acts as a deterministic state machine driven by a monotonic sequence number (`seq`). Instead of coupling the WebSocket `onmessage` directly to React state, messages flow through an explicit pipeline: Socket → `ConnectionManager` → `SeqBuffer` (Reordering & Deduplication) → `Zustand Store` → React DOM. This decoupling ensures the React layer only processes ordered, deduplicated protocol events, preventing inconsistent UI state during chaos-mode delivery.

## Protocol Support & Resilience
- **Sequence-Based Ordering**: All events are buffered until their strict sequential predecessor has been processed.
- **Idempotent Deduplication**: Duplicate sequence numbers are silently dropped via a `seenSeq` set.
- **Stateful Replay Recovery**: On disconnect, the client explicitly signals the highest *processed* sequence number, guaranteeing zero data loss during server replay.
- **Interruptible Tool Calls**: Mid-stream tool calls freeze the token stream exactly at the boundary. Resumption is gapless and seamless.
- **Performant Context Diffs**: Large context payloads are rendered through lazy tree expansion and tested against 500KB fixtures.

## Repository Structure
```text
src/
├── app/                  # Next.js App Router entry points
├── components/           
│   ├── chat/             # Streaming rendering, Tool Call cards
│   ├── context/          # JSON diff inspector
│   └── timeline/         # Agent trace timeline (Virtualized)
├── lib/
│   ├── diff/             # JSON diffing engine
│   ├── store/            # Zustand state management
│   └── ws/               # Protocol, ConnectionManager, SeqBuffer
```

## Setup Instructions

### 1. Start the Agent Server
```bash
cd agent-server
docker build -t agent-server .
# Run in normal mode:
docker run -p 4747:4747 agent-server
# Run in chaos mode:
docker run -p 4747:4747 agent-server --mode chaos
```

### 2. Start the Frontend
```bash
npm install
npm run dev
```
Open `http://localhost:3000` in your browser.

## Testing & Verification
- **Normal Mode**: Validates core streaming, tool call interruption, and timeline synchronization.
- **Chaos Mode**: Start the server with `--mode chaos` to test exponential backoff, out-of-order reassembly, and heartbeat corruption survival. The application will log recovery events directly to the console for verification.
- **Unit Tests**: Run `npm test` to execute the comprehensive test suite validating the sequence buffer and protocol state machines.

## Test Coverage

The repository includes tests for:
- SeqBuffer ordering
- SeqBuffer recovery
- Reconnection lifecycle
- TOOL_ACK delivery
- Heartbeat handling
- Timeline virtualization
- Concurrent tool rendering
- Context inspector behavior

Run:
```bash
npm test
```

## State Machine
Please see `docs/STATE_MACHINE.md` for the formal connection and stream lifecycle diagrams.
Please see `DECISIONS.md` for a deep dive into the engineering tradeoffs.