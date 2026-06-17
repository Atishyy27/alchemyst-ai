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
    ? 'text-emerald-600'
    : isWaitingOnReconnect
      ? 'text-amber-500 animate-pulse'
      : 'text-blue-500 animate-pulse';

  const statusIcon = toolCall.status === 'completed'
    ? (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ) : (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    );

  return (
    <div 
      data-testid={`tool-call-${call_id}`} 
      ref={el => highlightRegistry.registerChatRef(`chat_tool_${call_id}`, el)}
      className="border border-slate-200 rounded-lg my-1.5 text-sm bg-white shadow-sm cursor-pointer transition-all duration-200 hover:border-slate-300 hover:shadow"
      onClick={handleHighlight}
    >
      <div className="flex items-center gap-2 p-2.5 bg-slate-50 border-b border-slate-100 rounded-t-lg">
        <div className={statusClasses}>
          {statusIcon}
        </div>
        <span className="font-medium font-mono text-[12px] text-slate-700">
          {toolCall.tool_name}()
        </span>
        <span
          data-testid={`tool-status-${call_id}`}
          className={`text-[10px] uppercase font-bold tracking-wider ml-auto ${statusClasses}`}
        >
          {statusLabel}
        </span>
      </div>
      
      <details className="group" open={toolCall.status === 'pending'}>
        <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700 font-medium px-3 py-2 bg-white list-none flex items-center gap-1 border-b border-transparent group-open:border-slate-100">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          Arguments
        </summary>
        <div className="p-3 bg-white text-[11px] text-slate-600 font-mono overflow-x-auto">
          {JSON.stringify(toolCall.args, null, 2)}
        </div>
      </details>

      {toolCall.status === 'completed' && toolCall.result && (
        <details className="group border-t border-slate-100">
          <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700 font-medium px-3 py-2 bg-white list-none flex items-center gap-1 border-b border-transparent group-open:border-slate-100">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            Result
          </summary>
          <div className="p-3 bg-white text-[11px] text-slate-600 font-mono overflow-x-auto rounded-b-lg">
            {JSON.stringify(toolCall.result, null, 2)}
          </div>
        </details>
      )}
    </div>
  );
}

