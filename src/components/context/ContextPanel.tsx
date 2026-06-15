import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../lib/store/appStore';
import { JsonTree } from './JsonTree';
import { diffJson } from '../../lib/diff/jsonDiff';

export function ContextPanel() {
  const contexts = useAppStore(state => state.contexts);
  const contextIds = Object.keys(contexts);
  
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(-1); // -1 means follow latest

  const idToUse = selectedId && contextIds.includes(selectedId) ? selectedId : (contextIds[0] || null);

  useEffect(() => {
    setCurrentIndex(-1);
  }, [idToUse]);

  if (!idToUse) {
    return <div className="p-4 text-gray-500">No contexts available</div>;
  }

  const history = contexts[idToUse];
  if (!history || history.length === 0) {
    return <div className="p-4 text-gray-500">No history</div>;
  }

  const maxIndex = history.length - 1;
  const activeIndex = currentIndex === -1 || currentIndex > maxIndex ? maxIndex : Math.max(0, currentIndex);
  
  const currentSnapshot = history[activeIndex]?.data;
  const prevSnapshot = activeIndex > 0 ? history[activeIndex - 1]?.data : null;

  const diffs = prevSnapshot ? diffJson(prevSnapshot, currentSnapshot) : [];

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (val === maxIndex) {
      setCurrentIndex(-1);
    } else {
      setCurrentIndex(val);
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-gray-200">
      <div className="p-2 border-b border-gray-200 flex flex-col gap-2">
        <select 
          className="w-full p-1 border rounded text-sm"
          value={idToUse}
          onChange={(e) => setSelectedId(e.target.value)}
          data-testid="context-select"
        >
          {contextIds.map(id => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500 whitespace-nowrap">Step {activeIndex + 1}/{maxIndex + 1}</span>
          <input 
            type="range" 
            min="0" 
            max={maxIndex} 
            value={activeIndex} 
            onChange={handleSliderChange}
            className="w-full cursor-pointer"
            data-testid="context-slider"
          />
        </div>
      </div>
      <div className="p-4 overflow-auto flex-1">
        <JsonTree data={currentSnapshot} diffs={diffs} />
      </div>
    </div>
  );
}
