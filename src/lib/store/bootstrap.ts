import { ConnectionManager } from '../ws/connectionManager';
import { useAppStore } from './appStore';

/**
 * Initializes the connection between the WebSocket layer and the Application Store.
 * 
 * - Syncs ConnectionManager state to the store.
 * - Routes all ServerMessages into the store's reducers.
 * - Performs protocol side effects (like sending TOOL_ACK) outside of the
 *   pure store reducers.
 * 
 * @param cm The initialized ConnectionManager instance
 * @returns A cleanup function to unsubscribe listeners
 */
export function initializeAgentConsole(cm: ConnectionManager): () => void {
  // Sync connection state changes
  const unsubState = cm.onStateChange((state) => {
    useAppStore.getState().setConnectionStatus(state);
  });

  // Also set the initial state
  useAppStore.getState().setConnectionStatus(cm.getConnectionState());

  // Sync protocol messages and handle side effects
  const unsubMessage = cm.onMessage((msg) => {
    // 1. Pure state update
    useAppStore.getState().processServerMessage(msg);
  });

  // Track client protocol actions in the timeline
  const unsubDebug = cm.onDebugEvent((event) => {
    const state = useAppStore.getState();
    if (event.kind === 'heartbeat_sent') {
      state.addClientTimelineEvent({ type: 'pong', challenge: event.challenge, timestamp: event.timestamp });
    } else if (event.kind === 'resume_sent') {
      state.addClientTimelineEvent({ type: 'resume', last_seq: event.last_seq, timestamp: event.timestamp });
    } else if (event.kind === 'tool_ack_sent') {
      state.addClientTimelineEvent({ type: 'tool_ack', call_id: event.call_id, timestamp: event.timestamp });
    }
  });

  return () => {
    unsubState();
    unsubMessage();
    unsubDebug();
  };
}
