import React from 'react';
import { useAppStore } from '@/lib/store/appStore';

/**
 * ConnectionStatusBanner — fixed top bar showing reconnection state.
 *
 * - Renders nothing when connected or idle.
 * - Shows "Reconnecting... (attempt N)" or appropriate message for
 *   connecting/reconnecting/disconnected states.
 * - Takes its own height in the document flow (never an overlay).
 *   Parent should place it above the main content in a flex column.
 */
export function ConnectionStatusBanner() {
  const connectionStatus = useAppStore((state) => state.connectionStatus);

  if (connectionStatus === 'connected' || connectionStatus === 'idle') {
    return null;
  }

  const label = (() => {
    switch (connectionStatus) {
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'disconnected':
        return 'Disconnected — click to retry';
      default:
        return `Status: ${connectionStatus}`;
    }
  })();

  return (
    <div
      data-testid="connection-status-banner"
      className="w-full px-4 py-2 text-center text-sm font-medium bg-amber-500 text-white shadow-sm flex-shrink-0"
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-2">
        {connectionStatus === 'reconnecting' && (
          <svg
            className="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {label}
      </span>
    </div>
  );
}
