import React, { useState } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { highlightRegistry } from '@/lib/highlightRegistry';

export function TimelineRow({ index, style }: { index: number; style: React.CSSProperties }) {
  // Use fine-grained selectors so only the relevant row re-renders
  const ref = useAppStore((state) => state.timeline[index]);
  const stream = useAppStore((state) => ref.type === 'message' ? state.streams[ref.stream_id] : null);
  const toolCalls = useAppStore((state) => state.toolCalls); // Could also be fine-grained if needed
  const historyItem = useAppStore((state) => ref.type === 'context_snapshot' ? state.contexts[ref.context_id]?.find(s => s.seq === ref.seq) : null);
  
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
      
      const streamHeader = stream.segments.length === 0 ? (
        <div className="flex items-center gap-3 w-full group hover:bg-slate-50 border-b border-slate-100 py-2 px-4 transition-colors">
          <div className="w-24 shrink-0 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">STREAM</div>
          <div className="flex-1 text-[12px] font-mono text-slate-600 truncate">
            {stream.role} (Empty)
          </div>
          <div className="text-[10px] font-mono text-slate-400">id:{stream.stream_id.slice(-6)}</div>
        </div>
      ) : null;

      const segments = stream.segments.map((seg, i) => {
        if (seg.kind === 'text') {
          const isMatch = filter.showTokens && (matchesSearch(`Streamed ${seg.tokenCount ?? 0} ${seg.tokenCount === 1 ? 'token' : 'tokens'}`) || matchesSearch(seg.content));
          if (!isMatch) return <div key={i} className="hidden" data-testid={`text-segment-${index}-${i}`} />;
          isRowHidden = false;

          const isExpanded = !!expanded[i];
          const timeStr = (seg.startTime && seg.endTime) ? ` ${(seg.endTime - seg.startTime) / 1000}s` : '';
          return (
            <div 
              key={i} 
              className="flex flex-col w-full border-b border-slate-100 hover:bg-slate-50 transition-colors py-2 px-4 data-[highlighted=true]:bg-yellow-50"
              data-testid={`text-segment-${index}-${i}`}
            >
              <div 
                className="flex items-center gap-3 cursor-pointer select-none group"
                onClick={() => {
                  if (seg.firstSeq) highlightRegistry.highlightChatText(seg.firstSeq);
                  setExpanded(prev => ({ ...prev, [i]: !isExpanded }));
                }}
              >
                <div className="w-24 shrink-0 flex items-center gap-1.5 text-[10px] font-mono text-slate-500 uppercase tracking-wider font-semibold">
                  <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  TOKEN
                </div>
                <div className="flex-1 text-[12px] font-mono text-slate-600 truncate">
                  Streamed {seg.tokenCount ?? 0} {seg.tokenCount === 1 ? 'token' : 'tokens'}
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  {timeStr && <span>{timeStr}</span>}
                </div>
              </div>
              {isExpanded && (
                <div className="ml-27 mt-2 text-[11px] text-slate-700 whitespace-pre-wrap font-mono">
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

          const isExpanded = !!expanded[i];

          return (
            <div 
              key={i} 
              className="flex flex-col w-full border-b border-slate-100 hover:bg-indigo-50/30 transition-colors py-2 px-4 data-[highlighted=true]:bg-yellow-50"
              data-testid={`tool-segment-${index}-${i}`}
              ref={el => highlightRegistry.registerTimelineNodeRef(`timeline_tool_${seg.call_id}`, el)}
            >
              <div 
                className="flex items-center gap-3 cursor-pointer select-none group"
                onClick={() => {
                  highlightRegistry.highlightChatToolCall(seg.call_id);
                  setExpanded(prev => ({ ...prev, [i]: !isExpanded }));
                }}
              >
                <div className="w-24 shrink-0 flex items-center gap-1.5 text-[10px] font-mono text-indigo-500 uppercase tracking-wider font-semibold">
                  <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  {tool.status === 'completed' ? 'TOOL_RES' : 'TOOL_CALL'}
                </div>
                <div className="flex-1 flex items-center gap-2 text-[12px] font-mono text-indigo-700 truncate font-medium">
                  {tool.tool_name}()
                  <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wide ${tool.status === 'completed' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
                    {tool.status}
                  </span>
                  <span className="text-[10px] text-slate-500 truncate font-normal ml-2">
                    {JSON.stringify(tool.args)}
                    {tool.status === 'completed' && tool.result && ` -> ${JSON.stringify(tool.result)}`}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  call:{seg.call_id.slice(-6)}
                </div>
              </div>
              
              {isExpanded && (
                <div className="ml-27 mt-2 flex flex-col gap-2">
                  <div className="text-[10px] text-slate-500 font-mono">
                    <div className="uppercase tracking-wider font-semibold mb-1">Arguments</div>
                    <div className="whitespace-pre-wrap break-all text-slate-600">{JSON.stringify(tool.args, null, 2)}</div>
                  </div>
                  {tool.status === 'completed' && tool.result && (
                    <div className="text-[10px] text-slate-500 font-mono border-t border-slate-100 pt-2 mt-1">
                      <div className="uppercase tracking-wider font-semibold mb-1">Result</div>
                      <div className="whitespace-pre-wrap break-all text-slate-600">{JSON.stringify(tool.result, null, 2)}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        }
        return null;
      });

      content = (
        <div className="flex flex-col w-full h-full box-border">
          {streamHeader}
          {segments}
        </div>
      );
    }
  } else if (ref.type === 'tool_call') {
    return <div style={style} className="hidden" data-testid={`timeline-row-${index}-skipped`} />;
  } else if (ref.type === 'context_snapshot') {
    isRowHidden = true;
    const snapshot = historyItem;
    if (snapshot) {
      const isMatch = filter.showContexts && (matchesSearch('Context Snapshot') || matchesSearch(JSON.stringify(snapshot.data)));
      if (isMatch) isRowHidden = false;

      const bytes = JSON.stringify(snapshot.data).length;
      content = (
        <div className="flex items-center gap-3 w-full hover:bg-slate-50 border-b border-slate-100 py-2 px-4 transition-colors">
          <div className="w-24 shrink-0 text-[10px] font-mono text-emerald-600 uppercase tracking-wider font-semibold">
            CONTEXT
          </div>
          <div className="flex-1 text-[12px] font-mono text-slate-600 truncate">
            Snapshot stored
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400" data-testid={`context-size-${index}`}>
            <span>{bytes} bytes</span>
            <span>id:{ref.context_id.slice(-6)}</span>
          </div>
        </div>
      );
    }
  } else if (ref.type === 'ping') {
    isRowHidden = !filter.showPingsPongs;
    if (filter.searchQuery && !matchesSearch('PING') && !matchesSearch(ref.challenge)) isRowHidden = true;
    content = (
      <div className="flex items-center gap-3 w-full hover:bg-slate-50 border-b border-slate-100 py-2 px-4 transition-colors">
        <div className="w-24 shrink-0 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
          PING
        </div>
        <div className="flex-1 text-[12px] font-mono text-slate-600 truncate">
          Challenge: <span className="font-medium text-slate-800">{ref.challenge || '<empty>'}</span>
        </div>
      </div>
    );
  } else if (ref.type === 'pong') {
    isRowHidden = !filter.showPingsPongs;
    if (filter.searchQuery && !matchesSearch('PONG') && !matchesSearch(ref.challenge)) isRowHidden = true;
    content = (
      <div className="flex items-center gap-3 w-full hover:bg-slate-50 border-b border-slate-100 py-2 px-4 transition-colors">
        <div className="w-24 shrink-0 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
          PONG
        </div>
        <div className="flex-1 text-[12px] font-mono text-slate-600 truncate">
          Challenge: <span className="font-medium text-slate-800">{ref.challenge || '<empty>'}</span>
        </div>
      </div>
    );
  } else if (ref.type === 'resume') {
    isRowHidden = false; // Always show resumes unless filtered out by search? Actually just always show them
    if (filter.searchQuery && !matchesSearch('RESUME') && !matchesSearch(String(ref.last_seq))) isRowHidden = true;
    content = (
      <div className="flex items-center gap-3 w-full hover:bg-amber-50 border-b border-amber-100 py-2 px-4 transition-colors">
        <div className="w-24 shrink-0 text-[10px] font-mono text-amber-600 uppercase tracking-wider font-semibold">
          RESUME
        </div>
        <div className="flex-1 text-[12px] font-mono text-amber-700 truncate">
          Seq: <span className="font-medium">{ref.last_seq}</span>
        </div>
      </div>
    );
  } else if (ref.type === 'tool_ack') {
    isRowHidden = !filter.showToolCalls;
    if (filter.searchQuery && !matchesSearch('TOOL_ACK') && !matchesSearch(ref.call_id)) isRowHidden = true;
    content = (
      <div className="flex items-center gap-3 w-full hover:bg-indigo-50 border-b border-indigo-100 py-2 px-4 transition-colors">
        <div className="w-24 shrink-0 text-[10px] font-mono text-indigo-500 uppercase tracking-wider font-semibold">
          TOOL_ACK
        </div>
        <div className="flex-1 text-[12px] font-mono text-indigo-700 truncate">
          call_id: <span className="font-medium">{ref.call_id}</span>
        </div>
      </div>
    );
  } else if (ref.type === 'error') {
    isRowHidden = !filter.showErrors;
    if (filter.searchQuery && !matchesSearch('ERROR') && !matchesSearch(ref.code) && !matchesSearch(ref.message)) isRowHidden = true;
    content = (
      <div className="flex items-center gap-3 w-full hover:bg-rose-50 border-b border-rose-100 py-2 px-4 transition-colors bg-rose-50/50">
        <div className="w-24 shrink-0 text-[10px] font-mono text-rose-600 uppercase tracking-wider font-bold">
          ERROR
        </div>
        <div className="flex-1 text-[12px] font-mono text-rose-700 truncate font-medium">
          [{ref.code}] {ref.message}
        </div>
      </div>
    );
  }

  return (
    <div style={style} className={`${isRowHidden ? 'hidden' : ''}`} data-testid={`timeline-row-${index}`}>
      {content}
    </div>
  );
}
