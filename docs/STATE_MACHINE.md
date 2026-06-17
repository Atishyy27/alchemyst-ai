# Protocol State Machine

The Agent Console uses an explicit state machine to manage the lifecycle of the WebSocket connection and the incoming token streams.

## Connection Lifecycle

```mermaid
stateDiagram-v2
    [*] --> DISCONNECTED
    DISCONNECTED --> CONNECTING : connect()
    CONNECTING --> ERROR : Network Failure
    ERROR --> RECONNECTING : Backoff Timer
    RECONNECTING --> CONNECTING : Retry
    
    CONNECTING --> CONNECTED : onopen (First Boot)
    CONNECTING --> RESUMING : onopen (Reconnection)
    
    RESUMING --> CONNECTED : Server Replay Complete
    CONNECTED --> DISCONNECTED : WS_CLOSE (4001 or manual)
    CONNECTED --> RECONNECTING : WS_CLOSE (1000/1006)
```

## Stream Lifecycle

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> STREAMING : TOKEN
    STREAMING --> STREAMING : TOKEN
    
    STREAMING --> TOOL_PENDING : TOOL_CALL
    TOOL_PENDING --> STREAMING : TOOL_RESULT
    
    STREAMING --> IDLE : STREAM_END
```

Transitions:
- **DISCONNECTED**: Terminal state. Reconnection halted.
- **CONNECTING**: Socket initiating handshake.
- **CONNECTED**: Normal bidirectional communication.
- **STREAMING**: Actively appending tokens to the active stream ID.
- **TOOL_PENDING**: Token stream frozen. Waiting for TOOL_RESULT to resume.
- **RECONNECTING**: Waiting on exponential backoff timer.
- **RESUMING**: Connection established, awaiting flushed buffer from `last_seq` replay.
- **ERROR**: Temporary failure state before retry schedule.
