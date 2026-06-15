'use client';

import React, { useEffect, useRef } from 'react';
import { ConnectionManager } from '@/lib/ws/connectionManager';
import { initializeAgentConsole } from '@/lib/store/bootstrap';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useAppStore } from '@/lib/store/appStore';

export default function Home() {
  const cmRef = useRef<ConnectionManager | null>(null);

  useEffect(() => {
    // 1. Initialize the WebSocket Connection Manager
    const cm = new ConnectionManager({ url: 'ws://localhost:4747/ws', debug: true });
    cmRef.current = cm;
    
    // 2. Wire the CM to the Zustand store (AppStore)
    const cleanup = initializeAgentConsole(cm);
    
    // 3. Connect to the server
    cm.connect();

    return () => {
      cleanup();
      cm.disconnect();
    };
  }, []);

  const handleSendMessage = (content: string) => {
    if (!cmRef.current) return;
    
    // The store's action sends the optimistic update and resets the session internally
    const tempId = crypto.randomUUID();
    useAppStore.getState().sendUserMessage(content, tempId);
    
    // Send over WebSocket via CM (which routes it through the validation boundary)
    cmRef.current.send({
      type: 'USER_MESSAGE',
      content
    });
  };

  return (
    <main className="flex h-screen w-full bg-white overflow-hidden text-sm">
      {/* 
        Phase 2: Left column reserved for the Chat Panel.
        In Phase 3, the Timeline/Context features will occupy the right pane.
      */}
      <div className="w-full max-w-2xl border-r border-gray-200 h-full flex flex-col shadow-sm">
        <ChatPanel onSendMessage={handleSendMessage} />
      </div>
      
      {/* Placeholder for Phase 3 */}
      <div className="flex-1 bg-gray-50 flex items-center justify-center text-gray-400 font-medium">
        Timeline / Context Area (Phase 3)
      </div>
    </main>
  );
}
