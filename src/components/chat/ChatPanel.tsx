import React, { useState } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { MessageList } from './MessageList';

interface ChatPanelProps {
  onSendMessage: (content: string) => void;
}

export function ChatPanel({ onSendMessage }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const connectionStatus = useAppStore((state) => state.connectionStatus);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || connectionStatus !== 'connected') return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-white font-sans w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 bg-white border-b border-slate-200 shrink-0">
        <h2 className="font-semibold text-slate-800 text-[13px] tracking-tight">Agent Console</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider font-semibold">
            {connectionStatus}
          </span>
          <span className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-emerald-500' :
            connectionStatus === 'reconnecting' ? 'bg-amber-500 animate-pulse' :
            'bg-rose-500'
          }`} />
        </div>
      </div>

      <MessageList />

      {/* Input Area */}
      <div className="p-4 bg-slate-50 border-t border-slate-200 shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-4xl mx-auto w-full relative items-center bg-white border border-slate-200 rounded text-[13px] shadow-sm focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all overflow-hidden">
          <div className="pl-3 pr-2 text-slate-400 font-mono text-[13px] select-none">
            &gt;
          </div>
          <input
            className="flex-1 py-2.5 bg-transparent text-slate-800 font-mono placeholder-slate-400 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={connectionStatus === 'connected' ? "Execute command or send message..." : "Waiting for connection..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={connectionStatus !== 'connected'}
            autoFocus
          />
          <div className="pr-1.5 flex items-center">
            <button 
              type="submit"
              disabled={!input.trim() || connectionStatus !== 'connected'}
              className="px-3 py-1.5 bg-slate-800 text-white text-[11px] font-semibold uppercase tracking-wider rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Run
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
