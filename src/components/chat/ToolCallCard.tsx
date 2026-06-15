import React from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { highlightRegistry } from '@/lib/highlightRegistry';

interface ToolCallCardProps {
  call_id: string;
}

export function ToolCallCard({ call_id }: ToolCallCardProps) {
  // We use the raw store selector to access the specific tool call
  // This avoids re-rendering if other tool calls change
  const toolCall = useAppStore((state) => state.toolCalls[call_id]);
  const connectionStatus = useAppStore((state) => state.connectionStatus);

  if (!toolCall) return null;

  const handleHighlight = () => {
    const state = useAppStore.getState();
    const index = state.timeline.findIndex(t => t.type === 'tool_call' && t.call_id === call_id);
    if (index !== -1) {
      highlightRegistry.highlightTimelineToolCall(call_id, index);
    }
  };

  // Determine the display label for the status badge
  const isWaitingOnReconnect =
    toolCall.status === 'pending' && connectionStatus !== 'connected';

  const statusLabel = isWaitingOnReconnect
    ? 'Waiting for result (reconnecting...)'
    : toolCall.status;

  const statusClasses = toolCall.status === 'completed'
    ? 'bg-green-100 text-green-800'
    : isWaitingOnReconnect
      ? 'bg-orange-100 text-orange-800 animate-pulse'
      : 'bg-yellow-100 text-yellow-800 animate-pulse';

  return (
    <div 
      data-testid={`tool-call-${call_id}`} 
      className="border border-gray-200 rounded-md p-3 my-2 text-sm bg-gray-50 shadow-sm cursor-pointer transition-colors duration-300 hover:border-blue-300"
      onClick={handleHighlight}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold font-mono text-blue-600">
          {toolCall.tool_name}()
        </span>
        <span
          data-testid={`tool-status-${call_id}`}
          className={`text-xs px-2 py-1 rounded-full ${statusClasses}`}
        >
          {statusLabel}
        </span>
      </div>
      
      <details className="mt-1" open={toolCall.status === 'pending'}>
        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 font-medium">
          Arguments
        </summary>
        <pre className="mt-1 p-2 bg-white rounded border overflow-x-auto text-xs text-gray-700 font-mono">
          {JSON.stringify(toolCall.args, null, 2)}
        </pre>
      </details>

      {toolCall.status === 'completed' && toolCall.result && (
        <details className="mt-1">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 font-medium">
            Result
          </summary>
          <pre className="mt-1 p-2 bg-white rounded border overflow-x-auto text-xs text-gray-700 font-mono">
            {JSON.stringify(toolCall.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

