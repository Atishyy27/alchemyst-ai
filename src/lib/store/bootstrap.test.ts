import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeAgentConsole } from './bootstrap';
import { useAppStore } from './appStore';
import { ConnectionManager } from '../ws/connectionManager';
import type { ServerMessage } from '@/types/protocol';

describe('Store Bootstrap', () => {
  beforeEach(() => {
    useAppStore.getState().resetChat();
  });

  it('syncs state and dispatches TOOL_ACK on TOOL_CALL', () => {
    // We mock just enough of ConnectionManager to trigger events
    type StateChangeFn = (state: string) => void;
    type MessageFn = (msg: ServerMessage) => void;

    let triggerStateChange: StateChangeFn | undefined;
    let triggerMessage: MessageFn | undefined;

    const mockCm = {
      getConnectionState: () => 'idle',
      onStateChange: (fn: StateChangeFn) => {
        triggerStateChange = fn;
        return () => {};
      },
      onMessage: (fn: MessageFn) => {
        triggerMessage = fn;
        return () => {};
      },
      onDebugEvent: () => {
        return () => {};
      },
      send: vi.fn(),
    } as unknown as ConnectionManager;

    // Run the bootstrap
    initializeAgentConsole(mockCm);

    expect(triggerStateChange).toBeDefined();
    expect(triggerMessage).toBeDefined();

    // 1. Verify state sync
    triggerStateChange!('connected');
    expect(useAppStore.getState().connectionStatus).toBe('connected');

    // 2. Verify message processing
    const tokenMsg: ServerMessage = {
      type: 'TOKEN',
      stream_id: 's1',
      seq: 1,
      text: 'hello',
    };
    triggerMessage!(tokenMsg);

    expect(useAppStore.getState().streams['s1']).toBeDefined();
    expect(mockCm.send).not.toHaveBeenCalled(); // No ACK for TOKEN

    // 3. Verify TOOL_CALL updates the store
    const toolMsg: ServerMessage = {
      type: 'TOOL_CALL',
      stream_id: 's1',
      seq: 2,
      call_id: 'tc_1',
      tool_name: 'test',
      args: {},
    };
    triggerMessage!(toolMsg);

    expect(useAppStore.getState().toolCalls['tc_1']).toBeDefined();
    
    // The side-effect was moved to connectionManager.ts, so no send here.
    expect(mockCm.send).not.toHaveBeenCalled();
  });
});
