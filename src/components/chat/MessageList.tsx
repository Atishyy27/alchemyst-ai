import React, { useRef, useEffect } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { selectRenderableChatFeed } from '@/lib/store/chatSelectors';
import { StreamingText } from './StreamingText';
import { ToolCallCard } from './ToolCallCard';

export function MessageList() {
  const groups = useAppStore(selectRenderableChatFeed);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [groups]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {groups.map((group) => (
        <div 
          key={group.stream_id} 
          className={`flex flex-col ${group.role === 'user' ? 'items-end' : 'items-start'}`}
        >
          <div className="text-[11px] text-slate-400 mb-1.5 uppercase tracking-wider font-semibold">
            {group.role}
          </div>
          <div className={`w-full ${
            group.role === 'user' 
              ? 'text-slate-800' 
              : 'text-slate-700'
          }`}>
            <div className="space-y-2">
              {group.items.map((item, i) => {
                if (item.kind === 'text') {
                  return <StreamingText key={i} content={item.content} firstSeq={item.firstSeq} />;
                } else if (item.kind === 'tool_call') {
                  return <ToolCallCard key={i} call_id={item.call_id} />;
                }
                return null;
              })}
            </div>
            
            {group.role === 'agent' && group.status !== 'ended' && (
              <div className="mt-3 flex items-center space-x-1.5 opacity-50">
                <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
