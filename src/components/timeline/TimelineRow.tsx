import React, { useState } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { highlightRegistry } from '@/lib/highlightRegistry';

export function TimelineRow({ index, style }: { index: number; style: React.CSSProperties }) {
  // Use fine-grained selectors so only the relevant row re-renders
  const ref = useAppStore((state) => state.timeline[index]);
  const stream = useAppStore((state) => ref.type === 'message' ? state.streams[ref.stream_id] : null);
  const toolCalls = useAppStore((state) => state.toolCalls); // Could also be fine-grained if needed
  const historyItem = useAppStore((state) => ref.type === 'context_snapshot' ? state.contexts[ref.context_id]?.[ref.index] : null);
  
  const filter = useAppStore((state) => state.timelineFilter);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  let content = null;
  let isRowHidden = false;

  const matchesSearch = (text: string) => {
    if (!filter.searchQuery) return true;
    return text.toLowerCase().includes(filter.searchQuery.toLowerCase());
  };

  if (ref.type === 'message') {
    isRowHidden = true;
    if (stream) {
      if (stream.segments.length === 0) isRowHidden = false;
      content = (
        <div className="bg-white border border-blue-100 p-3 rounded-lg shadow-sm h-full box-border flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-blue-700 text-sm">Stream: {stream.role}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wide ${stream.isComplete ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700 animate-pulse'}`}>
              {stream.isComplete ? 'Complete' : 'Streaming'}
            </span>
          </div>
          <div className="text-xs text-gray-500 font-mono">ID: {stream.stream_id.slice(-8)}</div>
          
          <div className="flex flex-col gap-1 overflow-y-auto">
            {stream.segments.map((seg, i) => {
              if (seg.kind === 'text') {
                const isMatch = filter.showTokens && (matchesSearch(`Streamed ${seg.tokenCount ?? 0} tokens`) || matchesSearch(seg.content));
                if (!isMatch) return <div key={i} className="hidden" data-testid={`text-segment-${index}-${i}`} />;
                isRowHidden = false;

                const isExpanded = !!expanded[i];
                const timeStr = (seg.startTime && seg.endTime) ? ` (${(seg.endTime - seg.startTime) / 1000}s)` : '';
                return (
                  <div key={i} className="border-l-2 border-blue-200 pl-2 py-1 transition-colors duration-300 data-[highlighted=true]:bg-yellow-100" data-testid={`text-segment-${index}-${i}`}>
                    <div 
                      className="text-xs font-mono text-gray-700 cursor-pointer hover:text-blue-600 flex justify-between"
                      onClick={() => {
                        if (seg.firstSeq) {
                           highlightRegistry.highlightChatText(seg.firstSeq);
                        }
                        setExpanded(prev => ({ ...prev, [i]: !isExpanded }));
                      }}
                    >
                      <span>Streamed {seg.tokenCount ?? 0} tokens{timeStr}</span>
                      <span>{isExpanded ? '▼' : '▶'}</span>
                    </div>
                    {isExpanded && (
                      <div className="mt-1 text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 p-2 rounded">
                        {seg.content}
                      </div>
                    )}
                  </div>
                );
              } else if (seg.kind === 'tool_call') {
                const tool = toolCalls[seg.call_id];
                if (!tool) return null;
                
                const isMatch = filter.showToolCalls && (matchesSearch(tool.tool_name) || matchesSearch(JSON.stringify(tool.args)) || (tool.result ? matchesSearch(JSON.stringify(tool.result)) : false));
                if (!isMatch) return <div key={i} className="hidden" data-testid={`tool-segment-${index}-${i}`} />;
                isRowHidden = false;

                return (
                  <div 
                    key={i} 
                    className="border-l-2 border-purple-300 pl-2 py-1 bg-purple-50/50 rounded-r transition-colors duration-300 data-[highlighted=true]:bg-yellow-200" 
                    data-testid={`tool-segment-${index}-${i}`}
                    ref={el => highlightRegistry.registerTimelineNodeRef(`timeline_tool_${seg.call_id}`, el)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-purple-700">
                        {tool.tool_name}({Object.keys(tool.args).length ? '...' : ''})
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wide ${tool.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {tool.status}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500 font-mono overflow-hidden text-ellipsis whitespace-nowrap">
                      Args: {JSON.stringify(tool.args)}
                    </div>
                    {tool.status === 'completed' && tool.result && (
                      <div className="mt-1 pt-1 border-t border-purple-100 text-[10px] font-mono text-gray-600 bg-white p-1 rounded overflow-hidden text-ellipsis whitespace-nowrap">
                        Result: {JSON.stringify(tool.result)}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      );
    }
  } else if (ref.type === 'tool_call') {
    // Hidden since tool calls are rendered inside the stream message row
    return <div style={style} className="hidden" data-testid={`timeline-row-${index}-skipped`} />;
  } else if (ref.type === 'context_snapshot') {
    isRowHidden = true;
    const snapshot = historyItem;
    if (snapshot) {
      const isMatch = filter.showContexts && (matchesSearch('Context Snapshot') || matchesSearch(JSON.stringify(snapshot.data)));
      if (isMatch) isRowHidden = false;

      const bytes = JSON.stringify(snapshot.data).length;
      content = (
        <div className="bg-white border border-emerald-100 p-3 rounded-lg shadow-sm h-full box-border flex flex-col justify-center">
           <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-emerald-700 text-sm">Context Snapshot</span>
          </div>
          <div className="text-xs text-gray-600 font-mono">
            ID: <span className="text-gray-900">{ref.context_id}</span>
          </div>
          <div className="text-xs text-gray-600 font-mono mt-1" data-testid={`context-size-${index}`}>
            {bytes} bytes
          </div>
        </div>
      );
    }
  } else if (ref.type === 'ping') {
    isRowHidden = false; // Add a filter if needed, but PINGs are usually visible or searchable
    content = (
      <div className="bg-white border border-gray-300 p-3 rounded-lg shadow-sm h-full box-border flex flex-col justify-center">
         <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-gray-700 text-sm">PING</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wide bg-gray-100 text-gray-700">Heartbeat</span>
        </div>
        <div className="text-xs text-gray-600 font-mono mt-1">
          Challenge: <span className="text-gray-900">{ref.challenge || '<empty>'}</span>
        </div>
      </div>
    );
  } else if (ref.type === 'error') {
    isRowHidden = false;
    content = (
      <div className="bg-white border border-red-200 p-3 rounded-lg shadow-sm h-full box-border flex flex-col justify-center">
         <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-red-700 text-sm">ERROR</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wide bg-red-100 text-red-700">{ref.code}</span>
        </div>
        <div className="text-xs text-red-600 mt-1">
          {ref.message}
        </div>
      </div>
    );
  }

  return (
    <div style={style} className={`px-6 py-2 ${isRowHidden ? 'hidden' : ''}`} data-testid={`timeline-row-${index}`}>
      {content}
    </div>
  );
}
