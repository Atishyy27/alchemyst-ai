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

    // 2. Protocol side effect: ACK tool calls
    if (msg.type === 'TOOL_CALL') {
      cm.send({
        type: 'TOOL_ACK',
        call_id: msg.call_id,
      });
    }
  });

  return () => {
    unsubState();
    unsubMessage();
  };
}
