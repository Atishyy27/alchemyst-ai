import React, { useRef, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { List } from 'react-window';
import { TimelineRow } from './TimelineRow';
import { highlightRegistry } from '@/lib/highlightRegistry';

const RowWrapper = (props: Record<string, unknown>): React.ReactElement => {
  const index = props.index as number;
  const style = props.style as React.CSSProperties;
  return <TimelineRow index={index} style={style} />;
};


export const TimelinePanel = React.memo(function TimelinePanel() {
  const timeline = useAppStore(useShallow((state) => state.timeline));
  const filter = useAppStore((state) => state.timelineFilter);
  const setFilter = useAppStore((state) => state.setTimelineFilter);
  const listRef = useRef<any>(null);

  useEffect(() => {
    if (listRef.current) {
      highlightRegistry.listRef = listRef.current;
    }
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current && timeline.length > 0) {
      listRef.current.scrollToRow({ index: timeline.length - 1, align: 'end' });
    }
  }, [timeline.length]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Filter Bar */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white shrink-0 flex flex-col gap-3">
        <div className="flex gap-2 relative w-full max-w-sm">
          <svg className="w-4 h-4 absolute left-2.5 top-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input 
            type="text" 
            placeholder="Search events..." 
            className="w-full text-[13px] pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors text-slate-800 placeholder-slate-400"
            value={filter.searchQuery}
            onChange={e => setFilter({ searchQuery: e.target.value })}
            data-testid="timeline-search-input"
          />
        </div>
        <div className="flex gap-4 text-[12px] text-slate-600 font-medium">
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
            <input 
              type="checkbox" 
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={filter.showTokens} 
              onChange={e => setFilter({ showTokens: e.target.checked })}
              data-testid="filter-tokens"
            />
            Tokens
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
            <input 
              type="checkbox" 
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={filter.showToolCalls} 
              onChange={e => setFilter({ showToolCalls: e.target.checked })}
              data-testid="filter-toolcalls"
            />
            Tools
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
            <input 
              type="checkbox" 
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={filter.showContexts} 
              onChange={e => setFilter({ showContexts: e.target.checked })}
              data-testid="filter-contexts"
            />
            Contexts
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
            <input 
              type="checkbox" 
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={filter.showPingsPongs} 
              onChange={e => setFilter({ showPingsPongs: e.target.checked })}
              data-testid="filter-pingspongs"
            />
            Pings/Pongs
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-900 transition-colors">
            <input 
              type="checkbox" 
              className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              checked={filter.showErrors} 
              onChange={e => setFilter({ showErrors: e.target.checked })}
              data-testid="filter-errors"
            />
            Errors
          </label>
        </div>
      </div>
      
      <div className="flex-1 w-full h-full relative">
        {timeline.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
            <svg className="w-10 h-10 mb-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[13px] font-medium text-slate-600">No events recorded</p>
            <p className="text-[12px] mt-1 text-slate-400">Timeline events will appear here as they occur.</p>
          </div>
        ) : (
          <List
            listRef={listRef}
            style={{ width: '100%', height: 800 }}
            rowCount={timeline.length}
            rowHeight={(index) => {
              const ref = timeline[index];
              const matchesSearch = (text: string) => !filter.searchQuery || text.toLowerCase().includes(filter.searchQuery.toLowerCase());
              
              if (ref.type === 'tool_call') return 0;
              if (ref.type === 'message') {
                const stream = useAppStore.getState().streams[ref.stream_id];
                if (!stream || stream.segments.length === 0) return 0;
                let visibleCount = 0;
                for (const seg of stream.segments) {
                  if (seg.kind === 'text') {
                    if (filter.showTokens && (matchesSearch(`Streamed ${seg.tokenCount ?? 0} ${seg.tokenCount === 1 ? 'token' : 'tokens'}`) || matchesSearch(seg.content))) visibleCount++;
                  } else if (seg.kind === 'tool_call') {
                    const tool = useAppStore.getState().toolCalls[seg.call_id];
                    if (tool && filter.showToolCalls && (matchesSearch(tool.tool_name) || matchesSearch(JSON.stringify(tool.args)) || (tool.result && matchesSearch(JSON.stringify(tool.result))))) visibleCount++;
                  }
                }
                return visibleCount > 0 ? 40 + (visibleCount * 40) : 0; // Header (40px) + 40px per segment
              }
              if (ref.type === 'context_snapshot') {
                const snapshot = useAppStore.getState().contexts[ref.context_id]?.find(s => s.seq === ref.seq);
                if (snapshot && filter.showContexts && (matchesSearch('Context Snapshot') || matchesSearch(JSON.stringify(snapshot.data)))) return 40;
                return 0;
              }
              if (ref.type === 'ping' || ref.type === 'pong') {
                if (!filter.showPingsPongs) return 0;
                if (!matchesSearch('PING') && !matchesSearch('PONG') && !matchesSearch(ref.challenge)) return 0;
                return 40;
              }
              if (ref.type === 'error') {
                if (!filter.showErrors) return 0;
                if (!matchesSearch('ERROR') && !matchesSearch(ref.code) && !matchesSearch(ref.message)) return 0;
                return 40;
              }
              if (ref.type === 'resume') {
                if (!matchesSearch('RESUME') && !matchesSearch(String(ref.last_seq))) return 0;
                return 40;
              }
              if (ref.type === 'tool_ack') {
                if (!filter.showToolCalls) return 0;
                if (!matchesSearch('TOOL_ACK') && !matchesSearch(ref.call_id)) return 0;
                return 40;
              }
              return 40;
            }}
            rowComponent={RowWrapper}
            rowProps={{}}
          />
        )}
      </div>
    </div>
  );
});
