import React, { useRef, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { List } from 'react-window';
import { TimelineRow } from './TimelineRow';
import { highlightRegistry } from '@/lib/highlightRegistry';

export function TimelinePanel() {
  const timeline = useAppStore((state) => state.timeline);
  const filter = useAppStore((state) => state.timelineFilter);
  const setFilter = useAppStore((state) => state.setTimelineFilter);
  const listRef = useRef<any>(null);

  useEffect(() => {
    if (listRef.current) {
      highlightRegistry.listRef = listRef.current;
    }
  }, [listRef.current]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current && timeline.length > 0) {
      listRef.current.scrollToRow({ index: timeline.length - 1, align: 'end' });
    }
  }, [timeline.length]);

  return (
    <div className="flex flex-col h-full bg-gray-50 border-l border-gray-200">
      <div className="p-4 border-b border-gray-200 flex flex-col gap-3">
        <h2 className="font-bold text-gray-700 uppercase tracking-wider text-xs">Timeline Debug</h2>
        
        <div className="flex flex-col gap-2">
          <input 
            type="text" 
            placeholder="Search timeline..." 
            className="w-full text-xs p-1.5 border rounded"
            value={filter.searchQuery}
            onChange={e => setFilter({ searchQuery: e.target.value })}
            data-testid="timeline-search-input"
          />
          <div className="flex gap-3 text-xs text-gray-600">
            <label className="flex items-center gap-1 cursor-pointer">
              <input 
                type="checkbox" 
                checked={filter.showTokens} 
                onChange={e => setFilter({ showTokens: e.target.checked })}
                data-testid="filter-tokens"
              />
              Tokens
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input 
                type="checkbox" 
                checked={filter.showToolCalls} 
                onChange={e => setFilter({ showToolCalls: e.target.checked })}
                data-testid="filter-toolcalls"
              />
              Tools
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input 
                type="checkbox" 
                checked={filter.showContexts} 
                onChange={e => setFilter({ showContexts: e.target.checked })}
                data-testid="filter-contexts"
              />
              Contexts
            </label>
          </div>
        </div>
      </div>
      
      <div className="flex-1 w-full h-full">
        {timeline.length === 0 ? (
          <div className="text-gray-400 italic p-6 text-xs">No timeline events yet.</div>
        ) : (
          <List
            listRef={listRef}
            style={{ width: '100%', height: 800 }}
            rowCount={timeline.length}
            rowHeight={100}
            rowComponent={TimelineRow as any}
            rowProps={{}}
          />
        )}
      </div>
    </div>
  );
}
