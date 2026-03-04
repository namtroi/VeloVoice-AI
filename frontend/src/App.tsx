/**
 * App.tsx — VeloVoice AI root component
 *
 * Polished layout integrating the VoiceControls, AudioVisualizer,
 * and TranscriptPanel using Tailwind CSS.
 */

import { useCallback, useEffect, useRef } from 'react'
import { WsClient } from './lib/ws-client'
import { useSessionStore } from './stores/session-store'
import { AudioCapture } from './lib/audio-capture'
import { AudioPlayback } from './lib/audio-playback'
import { VadController } from './lib/vad'
import { ErrorBoundary } from './components/error-boundary'

import { VoiceControls } from './components/voice-controls'
import { TranscriptPanel } from './components/transcript-panel'
import { AudioVisualizer } from './components/audio-visualizer'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
    : 'ws://localhost:8000/ws'

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
  const captureRef = useRef<AudioCapture | null>(null)
  const playbackRef = useRef<AudioPlayback | null>(null)
  const vadRef = useRef<VadController | null>(null)

  // Build WsHandlers wired to the store
  const getHandlers = useCallback(
    () => ({
      onSessionReady(id: string) {
        setSessionId(id)
      },
      onTranscriptPartial() {
        setStatus('processing')
      },
      onTranscriptFinal(text: string) {
        addMessage('assistant', text)
        setStatus('connected')
      },
      onResponseAudio(chunk: ArrayBuffer) {
        setStatus('speaking')
        playbackRef.current?.push(chunk).catch(console.error)
      },
      onResponseEnd() {
        setStatus('connected')
        playbackRef.current?.drain().catch(console.error)
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

  const handleConnect = useCallback(async () => {
    try {
      // 1. Init Audio instances
      captureRef.current = new AudioCapture()
      playbackRef.current = new AudioPlayback()
      vadRef.current = new VadController()

      // 2. Init WS client
      const client = new WsClient()
      clientRef.current = client
      client.connect(WS_URL, getHandlers())
      
      // 3. Start Capture (listens to mic, pushes to WS IF vadActive is true)
      await captureRef.current.start((chunk) => {
        clientRef.current?.sendAudioChunk(chunk)
      })

      // 4. Start VAD
      await vadRef.current.start(
        () => {
          // Speech started
          captureRef.current?.setVadActive(true)
          setStatus('listening')
        },
        () => {
          // Speech ended
          captureRef.current?.setVadActive(false)
          clientRef.current?.sendAudioStop()
          setStatus('processing')
        }
      )

      connect()
    } catch (err: unknown) {
      console.error('Failed to connect audio:', err)
      const errorStr = err instanceof Error ? err.message : String(err)
      setError(errorStr || 'Failed to request microphone permissions')
    }
  }, [connect, getHandlers, setStatus, setError])

  const handleDisconnect = useCallback(() => {
    // Teardown everything
    vadRef.current?.stop()
    vadRef.current = null

    captureRef.current?.stop()
    captureRef.current = null

    playbackRef.current?.stop()
    playbackRef.current = null

    clientRef.current?.disconnect()
    clientRef.current = null

    disconnect()
  }, [disconnect])

  const handleClearError = useCallback(() => {
    setError(null)
  }, [setError])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      vadRef.current?.stop()
      captureRef.current?.stop()
      playbackRef.current?.stop()
      clientRef.current?.disconnect()
    }
  }, [])

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-dvh bg-gray-950 text-gray-100 font-sans overflow-hidden selection:bg-blue-500/30">
        
        {/* Header */}
      <header className="flex-none px-6 py-4 border-b border-gray-800 bg-gray-900/80 backdrop-blur-md z-20 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-gray-100 to-gray-400">
            VeloVoice AI
          </h1>
        </div>
        
        {/* Session ID Pill */}
        {sessionId && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700 text-xs font-mono text-gray-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {sessionId.slice(0, 8)}
          </div>
        )}
      </header>

      {/* Main Content Layout */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 gap-6 z-10 relative">
        
        {/* Left Column: Visuals & Controls */}
        <div className="flex flex-col gap-6 w-full lg:w-1/3 min-w-[320px] shrink-0">
          <AudioVisualizer status={status} />
          
          <div className="flex-1 flex items-center justify-center">
            <VoiceControls 
              status={status}
              isConnected={isConnected}
              error={error}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onClearError={handleClearError}
            />
          </div>
        </div>

        {/* Right Column: Transcript */}
        <div className="flex-1 flex flex-col min-h-0">
          <TranscriptPanel 
            transcript={transcript}
            status={status}
          />
        </div>

      </main>
      
        {/* Background decorations */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[120px] pointer-events-none" />

      </div>
    </ErrorBoundary>
  )
}
