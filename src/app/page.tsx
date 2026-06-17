'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ConnectionManager } from '@/lib/ws/connectionManager';
import { initializeAgentConsole } from '@/lib/store/bootstrap';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { TimelinePanel } from '@/components/timeline/TimelinePanel';
import { ContextPanel } from '@/components/context/ContextPanel';
import { ConnectionStatusBanner } from '@/components/ConnectionStatusBanner';
import { useAppStore } from '@/lib/store/appStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function Home() {
  const cmRef = useRef<ConnectionManager | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'context'>('timeline');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // 1. Initialize the WebSocket Connection Manager
    useAppStore.getState().resetChat();
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
    
    if (cmRef.current.getConnectionState() !== 'connected') {
      setToast('Message not sent — reconnecting...');
      setTimeout(() => setToast(null), 3000);
      return;
    }

    // Send over WebSocket via CM (which routes it through the validation boundary)
    const success = cmRef.current.send({
      type: 'USER_MESSAGE',
      content
    });

    if (success) {
      // The store's action sends the optimistic update and resets the session internally
      const tempId = crypto.randomUUID();
      useAppStore.getState().sendUserMessage(content, tempId);
    } else {
      setToast('Message not sent — reconnecting...');
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {/* Top Connection Banner */}
      <ConnectionStatusBanner />
      
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-rose-500 text-white px-4 py-2 rounded shadow-lg text-[13px] font-semibold tracking-wide flex items-center gap-2 transition-opacity">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {toast}
        </div>
      )}
      
      {/* Main Structural Layout Split */}
      <main className="flex flex-row flex-1 w-full h-[calc(100vh-3rem)] overflow-hidden max-w-[1600px] mx-auto bg-white border-x border-slate-200 shadow-sm">
        
        {/* Chat Panel - Left Pane */}
        <div className="w-[45%] min-w-[380px] max-w-2xl border-r border-slate-200 h-full flex flex-col bg-white shrink-0">
          <ErrorBoundary label="Chat">
            <ChatPanel onSendMessage={handleSendMessage} />
          </ErrorBoundary>
        </div>
        
        {/* Debug Panel - Right Pane */}
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
          
          {/* Tabs Navigation Header */}
          <div className="flex items-center px-6 h-12 border-b border-slate-200 bg-white shrink-0">
            <div className="flex space-x-6 h-full items-center">
              <button 
                onClick={() => setActiveTab('timeline')}
                className={`relative flex items-center h-full text-[13px] font-semibold transition-colors cursor-pointer ${
                  activeTab === 'timeline' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Timeline
                {activeTab === 'timeline' && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600 rounded-t-sm" />
                )}
              </button>
              
              <button 
                onClick={() => setActiveTab('context')}
                className={`relative flex items-center h-full text-[13px] font-semibold transition-colors cursor-pointer ${
                  activeTab === 'context' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Context
                {activeTab === 'context' && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600 rounded-t-sm" />
                )}
              </button>
            </div>
          </div>
          
          {/* Tab Content Display Blocks */}
          <div className="flex-1 overflow-hidden relative bg-slate-50">
            {/* Timeline View Container */}
            <div className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'timeline' ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'
            }`} style={{ willChange: 'opacity' }}>
              <ErrorBoundary label="Timeline">
                <TimelinePanel />
              </ErrorBoundary>
            </div>

            {/* Context View Container */}
            <div className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'context' ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'
            }`} style={{ willChange: 'opacity' }}>
              <ErrorBoundary label="Context">
                <ContextPanel />
              </ErrorBoundary>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}