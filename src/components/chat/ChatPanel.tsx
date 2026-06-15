import React, { useState } from 'react';
import { useAppStore } from '@/lib/store/appStore';
import { MessageList } from './MessageList';

interface ChatPanelProps {
  /**
   * Callback to actually send the message over the network.
   * The UI layer doesn't own the ConnectionManager, so the parent
   * must bridge the store update and the network call.
   */
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
    <div className="flex flex-col h-full bg-gray-50 font-sans border-r border-gray-200">
      <div className="flex items-center justify-between p-4 bg-white border-b shadow-sm z-10">
        <h2 className="font-semibold text-gray-800 tracking-tight">Agent Console</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 uppercase font-medium tracking-wider">
            {connectionStatus}
          </span>
          <span className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
            connectionStatus === 'reconnecting' ? 'bg-yellow-500 animate-pulse' :
            'bg-red-500'
          }`} />
        </div>
      </div>

      <MessageList />

      <div className="p-4 bg-white border-t border-gray-200">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-4xl mx-auto w-full relative">
          <input
            className="flex-1 pl-4 pr-12 py-3 bg-gray-100 border-transparent rounded-full focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={connectionStatus === 'connected' ? "Message the agent..." : "Waiting for connection..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={connectionStatus !== 'connected'}
          />
          <button 
            type="submit"
            disabled={!input.trim() || connectionStatus !== 'connected'}
            className="absolute right-1 top-1 bottom-1 px-5 bg-blue-600 text-white font-medium rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
