/**
 * App.tsx — VeloVoice AI root component
 *
 * Wires WsClient → SessionStore and renders:
 *   - Connection button (connect / disconnect)
 *   - Status badge (idle | connected | listening | processing | speaking)
 *   - Error banner (dismissible)
 *   - Transcript panel (message list)
 */

import { useCallback, useEffect, useRef } from 'react'
import { WsClient } from './lib/ws-client'
import { useSessionStore } from './stores/session-store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : 'ws://localhost:8000/ws'

const STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  connected: 'Connected',
  listening: 'Listening',
  processing: 'Processing',
  speaking: 'Speaking',
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  connected: '#22c55e',
  listening: '#3b82f6',
  processing: '#f59e0b',
  speaking: '#a855f7',
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const {
    sessionId,
    status,
    transcript,
    isConnected,
    error,
    connect,
    disconnect,
    setSessionId,
    addMessage,
    setStatus,
    setError,
  } = useSessionStore()

  const clientRef = useRef<WsClient | null>(null)

  // Build WsHandlers wired to the store
  const getHandlers = useCallback(
    () => ({
      onSessionReady(id: string) {
        setSessionId(id)
      },
      onTranscriptPartial(_text: string) {
        setStatus('processing')
      },
      onTranscriptFinal(text: string) {
        addMessage('user', text)
        setStatus('connected')
      },
      onResponseAudio(_chunk: ArrayBuffer) {
        setStatus('speaking')
      },
      onResponseEnd() {
        setStatus('connected')
      },
      onError(code: string, message: string, fatal: boolean) {
        setError(`[${code}] ${message}`)
        if (fatal) {
          disconnect()
        }
      },
    }),
    [setSessionId, addMessage, setStatus, setError, disconnect],
  )

  const handleConnect = useCallback(() => {
    const client = new WsClient()
    clientRef.current = client
    client.connect(WS_URL, getHandlers())
    connect()
  }, [connect, getHandlers])

  const handleDisconnect = useCallback(() => {
    clientRef.current?.disconnect()
    clientRef.current = null
    disconnect()
  }, [disconnect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect()
    }
  }, [])

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>🎙️ VeloVoice AI</h1>
        <div style={styles.badgeRow}>
          <span
            style={{
              ...styles.badge,
              backgroundColor: STATUS_COLORS[status] ?? '#6b7280',
            }}
          >
            {STATUS_LABELS[status] ?? status}
          </span>
          {sessionId && (
            <span style={styles.sessionId} title={sessionId}>
              {sessionId.slice(0, 8)}…
            </span>
          )}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div style={styles.errorBanner} role="alert">
          ⚠️ {error}
          <button
            style={styles.dismissBtn}
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Transcript */}
      <main style={styles.transcript} aria-label="Transcript">
        {transcript.length === 0 && (
          <p style={styles.placeholder}>
            {isConnected
              ? 'Start speaking to begin transcription…'
              : 'Connect to start a voice session.'}
          </p>
        )}
        {transcript.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.role === 'user' ? '#3b82f6' : '#374151',
            }}
          >
            <span style={styles.messageRole}>
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </span>
            <p style={styles.messageText}>{msg.text}</p>
          </div>
        ))}
      </main>

      {/* Controls */}
      <footer style={styles.footer}>
        {!isConnected ? (
          <button
            id="btn-connect"
            style={{ ...styles.btn, backgroundColor: '#22c55e' }}
            onClick={handleConnect}
          >
            Connect
          </button>
        ) : (
          <button
            id="btn-disconnect"
            style={{ ...styles.btn, backgroundColor: '#ef4444' }}
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        )}
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline styles — no Tailwind dependency for the root wiring layer
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    backgroundColor: '#111827',
    color: '#f9fafb',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid #1f2937',
  },
  title: { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  badgeRow: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  badge: {
    borderRadius: '9999px',
    padding: '0.2rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#fff',
  },
  sessionId: { fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'monospace' },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    backgroundColor: '#7f1d1d',
    color: '#fca5a5',
    padding: '0.75rem 1.5rem',
    fontSize: '0.875rem',
  },
  dismissBtn: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '1rem',
  },
  transcript: {
    flex: 1,
    overflowY: 'auto',
    padding: '1rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  placeholder: { color: '#6b7280', textAlign: 'center', marginTop: '2rem' },
  message: {
    maxWidth: '70%',
    borderRadius: '0.75rem',
    padding: '0.6rem 1rem',
  },
  messageRole: { fontSize: '0.65rem', fontWeight: 700, opacity: 0.7, display: 'block' },
  messageText: { margin: 0, fontSize: '0.9rem', lineHeight: 1.5 },
  footer: {
    padding: '1rem 1.5rem',
    borderTop: '1px solid #1f2937',
    display: 'flex',
    justifyContent: 'center',
  },
  btn: {
    padding: '0.6rem 2rem',
    borderRadius: '9999px',
    border: 'none',
    color: '#fff',
    fontWeight: 600,
    fontSize: '0.95rem',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
}
