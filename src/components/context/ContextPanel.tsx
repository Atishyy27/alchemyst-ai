import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../lib/store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { JsonTree } from './JsonTree';
import { diffJson } from '../../lib/diff/jsonDiff';

export const ContextPanel = React.memo(function ContextPanel() {
  const contexts = useAppStore(useShallow(state => state.contexts));
  const contextIds = Object.keys(contexts);
  
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(-1); // -1 means follow latest

  const idToUse = selectedId && contextIds.includes(selectedId) ? selectedId : (contextIds[0] || null);

  useEffect(() => {
    setCurrentIndex(-1);
  }, [idToUse]);

  const history = idToUse ? contexts[idToUse] : undefined;
  const hasHistory = history && history.length > 0;
  
  const maxIndex = hasHistory ? history.length - 1 : 0;
  const activeIndex = currentIndex === -1 || currentIndex > maxIndex ? maxIndex : Math.max(0, currentIndex);
  
  const currentSnapshot = hasHistory ? history[activeIndex]?.data : null;
  const prevSnapshot = hasHistory && activeIndex > 0 ? history[activeIndex - 1]?.data : null;

  const diffs = React.useMemo(() => {
    return prevSnapshot ? diffJson(prevSnapshot, currentSnapshot) : [];
  }, [prevSnapshot, currentSnapshot]);

  if (!idToUse) {
    return (
      <div className="h-full bg-[#fafafa] flex flex-col items-center justify-center text-slate-400">
        <svg className="w-10 h-10 mb-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <p className="text-[13px] font-medium text-slate-600">No contexts available</p>
        <p className="text-[12px] mt-1 text-slate-400">Context snapshots will appear here.</p>
      </div>
    );
  }

  if (!hasHistory) {
    return (
      <div className="h-full bg-[#fafafa] flex flex-col items-center justify-center text-slate-400">
        <svg className="w-10 h-10 mb-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-[13px] font-medium text-slate-600">No history for this context</p>
        <p className="text-[12px] mt-1 text-slate-400">Waiting for snapshots...</p>
      </div>
    );
  }

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (val === maxIndex) {
      setCurrentIndex(-1);
    } else {
      setCurrentIndex(val);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="px-4 py-3 border-b border-slate-200 bg-white shrink-0 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Context Source</label>
          <select 
            className="w-full max-w-sm p-1.5 border border-slate-200 rounded text-[13px] text-slate-800 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            value={idToUse}
            onChange={(e) => setSelectedId(e.target.value)}
            data-testid="context-select"
          >
            {contextIds.map(id => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-center text-[11px] font-medium">
            <span className="text-slate-500 uppercase tracking-wider">Time Travel</span>
            <span className="text-slate-700 font-mono bg-slate-100 px-2 py-0.5 rounded">
              Step {activeIndex + 1} / {maxIndex + 1}
            </span>
          </div>
          <input 
            type="range" 
            min="0" 
            max={maxIndex} 
            value={activeIndex} 
            onChange={handleSliderChange}
            className="w-full max-w-sm h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            data-testid="context-slider"
          />
        </div>
        
        {activeIndex > 0 && (
          <div className="flex items-center gap-4 mt-2 text-[11px] font-mono bg-slate-50 p-2 rounded border border-slate-100">
            <span className="text-amber-600 font-semibold">Changed fields: {diffs.filter(d => d.kind === 'changed').length}</span>
            <span className="text-emerald-600 font-semibold">Added: {diffs.filter(d => d.kind === 'added').length}</span>
            <span className="text-rose-600 font-semibold">Removed: {diffs.filter(d => d.kind === 'removed').length}</span>
          </div>
        )}
      </div>
      <div className="p-4 overflow-auto flex-1 font-mono text-[12px]">
        <JsonTree data={currentSnapshot} diffs={diffs} />
      </div>
    </div>
  );
});
