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
          <div className="text-xs text-gray-500 mb-1 px-1 capitalize tracking-wide font-medium">
            {group.role}
          </div>
          <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
            group.role === 'user' 
              ? 'bg-blue-600 text-white rounded-br-sm' 
              : 'bg-white border border-gray-100 rounded-bl-sm text-gray-800'
          }`}>
            <div className="space-y-1">
              {group.items.map((item, i) => {
                if (item.kind === 'text') {
                  return <StreamingText key={i} content={item.content} />;
                } else if (item.kind === 'tool_call') {
                  return <ToolCallCard key={i} call_id={item.call_id} />;
                }
                return null;
              })}
            </div>
            
            {group.role === 'agent' && group.status !== 'ended' && (
              <div className="mt-2 flex items-center space-x-1">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
