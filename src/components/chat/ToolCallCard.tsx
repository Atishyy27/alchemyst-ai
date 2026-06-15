import React from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { selectToolCall } from '@/lib/store/chatSelectors';

interface ToolCallCardProps {
  call_id: string;
}

export function ToolCallCard({ call_id }: ToolCallCardProps) {
  // We use the raw store selector to access the specific tool call
  // This avoids re-rendering if other tool calls change
  const toolCall = useAppStore((state) => state.toolCalls[call_id]);

  if (!toolCall) return null;

  return (
    <div className="border border-gray-200 rounded-md p-3 my-2 text-sm bg-gray-50 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold font-mono text-blue-600">
          {toolCall.tool_name}()
        </span>
        <span className={`text-xs px-2 py-1 rounded-full ${
          toolCall.status === 'completed' 
            ? 'bg-green-100 text-green-800' 
            : 'bg-yellow-100 text-yellow-800 animate-pulse'
        }`}>
          {toolCall.status}
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
