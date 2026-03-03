/**
 * voice-controls.tsx
 *
 * Microhone interaction widget with state-based buttons and badges.
 */

import type { SessionStatus } from '../stores/session-store'

interface VoiceControlsProps {
  status: SessionStatus
  isConnected: boolean
  error: string | null
  onConnect: () => void
  onDisconnect: () => void
  onClearError: () => void
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'Ready to connect',
  connected: 'Connected',
  listening: 'Listening...',
  processing: 'Thinking...',
  speaking: 'Speaking',
}

const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: 'bg-gray-600',
  connected: 'bg-green-500',
  listening: 'bg-blue-500',
  processing: 'bg-amber-500',
  speaking: 'bg-purple-500',
}

export function VoiceControls({
  status,
  isConnected,
  error,
  onConnect,
  onDisconnect,
  onClearError,
}: VoiceControlsProps) {
  return (
    <div className="flex flex-col items-center gap-6 p-6 sm:p-8 bg-gray-800 rounded-3xl shadow-xl max-w-md w-full mx-auto border border-gray-700/50">
      
      {/* Error Banner */}
      {error && (
        <div className="w-full flex items-center justify-between bg-red-900/50 text-red-200 px-4 py-3 rounded-xl text-sm border border-red-800/50 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <span className="text-red-400">⚠️</span>
            <span>{error}</span>
          </div>
          <button 
            onClick={onClearError}
            className="hover:bg-red-800 p-1 rounded-md transition-colors"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Mic Button */}
      <div className="relative group">
        {/* Pulsing ring when active */}
        {isConnected && (
          <div className={`absolute -inset-4 rounded-full opacity-20 blur-md transition-colors duration-500 ${STATUS_COLORS[status]} animate-pulse`} />
        )}
        
        <button
          onClick={isConnected ? onDisconnect : onConnect}
          className={`
            relative flex items-center justify-center w-24 h-24 rounded-full 
            transition-all duration-300 shadow-lg border-4
            ${!isConnected 
              ? 'bg-gray-700 border-gray-600 hover:bg-gray-600 hover:border-gray-500 text-gray-300' 
              : 'bg-gray-800 border-red-500/80 hover:bg-red-900/40 text-red-500 hover:border-red-400'
            }
          `}
          aria-label={isConnected ? "Disconnect" : "Connect Voice Assistant"}
        >
          {!isConnected ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="4"/>
            </svg>
          )}
        </button>
      </div>

      {/* Status Badge */}
      <div className="flex flex-col items-center gap-2">
        <h2 className={`font-semibold text-lg transition-colors duration-300 ${isConnected ? 'text-gray-100' : 'text-gray-400'}`}>
          {STATUS_LABELS[status]}
        </h2>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-gray-900/50 border border-gray-700/50">
          <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]} ${status !== 'idle' ? 'animate-pulse' : ''}`} />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {status}
          </span>
        </div>
      </div>
    </div>
  )
}
