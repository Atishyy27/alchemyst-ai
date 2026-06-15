'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { ConnectionManager } from '@/lib/ws/connectionManager';
import type { ConnectionState } from '@/types/stateMachine';
import type { ServerMessage } from '@/types/protocol';

// ─────────────────────────────────────────────────────────────
// Debug page — protocol-level diagnostics only.
// Intentionally simple. Not a UI showcase.
// ─────────────────────────────────────────────────────────────

interface LogEntry {
  readonly seq: number;
  readonly type: string;
  readonly preview: string;
  readonly timestamp: string;
}

/** Short payload preview (≤80 chars) for a given message. */
function previewMessage(msg: ServerMessage): string {
  switch (msg.type) {
    case 'TOKEN':
      return `text=${JSON.stringify(msg.text)} stream=${msg.stream_id}`;
    case 'TOOL_CALL':
      return `call=${msg.call_id} tool=${msg.tool_name}`;
    case 'TOOL_RESULT':
      return `call=${msg.call_id} keys=[${Object.keys(msg.result).join(',')}]`;
    case 'CONTEXT_SNAPSHOT':
      return `ctx=${msg.context_id} size=${JSON.stringify(msg.data).length}B`;
    case 'PING':
      return `challenge=${JSON.stringify(msg.challenge)}`;
    case 'STREAM_END':
      return `stream=${msg.stream_id}`;
    case 'ERROR':
      return `code=${msg.code} msg=${msg.message}`;
  }
}

export default function DebugPage() {
  const [connState, setConnState] = useState<ConnectionState>('idle');
  const [lastSeq, setLastSeq] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const managerRef = useRef<ConnectionManager | null>(null);

  const addLog = useCallback((msg: ServerMessage) => {
    const entry: LogEntry = {
      seq: msg.seq,
      type: msg.type,
      preview: previewMessage(msg),
      timestamp: new Date().toLocaleTimeString(),
    };

    console.log(`[debug] seq=${entry.seq} type=${entry.type} ${entry.preview}`);

    setLogs((prev) => [entry, ...prev].slice(0, 500));
    setMessageCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const manager = new ConnectionManager({ debug: true });
    managerRef.current = manager;

    const unsubMsg = manager.onMessage((msg) => {
      addLog(msg);
      setLastSeq(manager.getLastProcessedSeq());
    });

    const unsubState = manager.onStateChange((newState) => {
      setConnState(newState);

      // On connect, send the trigger message.
      if (newState === 'connected') {
        try {
          manager.send({ type: 'USER_MESSAGE', content: 'Summarise the Q3 report' });
        } catch (err) {
          console.error('[debug] Failed to send USER_MESSAGE:', err);
        }
      }
    });

    manager.connect();

    return () => {
      unsubMsg();
      unsubState();
      manager.disconnect();
    };
  }, [addLog]);

  return (
    <div style={{
      fontFamily: 'monospace',
      padding: '2rem',
      backgroundColor: '#0d1117',
      color: '#c9d1d9',
      minHeight: '100vh',
    }}>
      <h1 style={{ color: '#58a6ff', margin: '0 0 1rem 0', fontSize: '1.25rem' }}>
        Protocol Debug
      </h1>

      {/* ── Status bar ───────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: '2rem',
        padding: '0.75rem 1rem',
        backgroundColor: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '6px',
        marginBottom: '1rem',
        fontSize: '0.875rem',
      }}>
        <div>
          <span style={{ color: '#8b949e' }}>State: </span>
          <span style={{
            padding: '0.15rem 0.5rem',
            borderRadius: '8px',
            fontSize: '0.75rem',
            fontWeight: 600,
            backgroundColor:
              connState === 'connected' ? '#238636' :
              connState === 'connecting' || connState === 'reconnecting' ? '#9e6a00' :
              '#da3633',
            color: '#fff',
          }}>
            {connState}
          </span>
        </div>
        <div>
          <span style={{ color: '#8b949e' }}>lastProcessedSeq: </span>
          <span style={{ color: '#f0883e' }}>{lastSeq}</span>
        </div>
        <div>
          <span style={{ color: '#8b949e' }}>processed: </span>
          <span style={{ color: '#f0883e' }}>{messageCount}</span>
        </div>
      </div>

      {/* ── Log table ────────────────────────────── */}
      <div style={{
        backgroundColor: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '6px',
        overflow: 'auto',
        maxHeight: '70vh',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.8rem',
        }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e' }}>
              <th style={{ padding: '0.5rem', textAlign: 'left', width: '80px' }}>Time</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', width: '50px' }}>Seq</th>
              <th style={{ padding: '0.5rem', textAlign: 'left', width: '140px' }}>Type</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Payload</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #21262d' }}>
                <td style={{ padding: '0.4rem 0.5rem', color: '#8b949e' }}>{log.timestamp}</td>
                <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#f0883e' }}>{log.seq}</td>
                <td style={{ padding: '0.4rem 0.5rem', color: '#3fb950' }}>{log.type}</td>
                <td style={{ padding: '0.4rem 0.5rem', color: '#c9d1d9' }}>{log.preview}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#8b949e' }}>
                  Waiting for events...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
