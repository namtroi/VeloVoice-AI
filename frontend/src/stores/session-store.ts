/**
 * session-store.ts — VeloVoice AI session state (Zustand)
 *
 * Single source of truth for connection state, transcript, and errors.
 */

import { create } from 'zustand'

export type SessionStatus = 'idle' | 'connected' | 'listening' | 'processing' | 'speaking'

// Module-level counter for stable React keys — never resets, always increasing.
let _messageId = 0

export interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
}

export interface SessionState {
  sessionId: string | null
  status: SessionStatus
  transcript: Message[]
  isConnected: boolean
  error: string | null

  // Actions
  connect: () => void
  disconnect: () => void
  setSessionId: (id: string) => void
  addMessage: (role: 'user' | 'assistant', text: string) => void
  setStatus: (status: SessionStatus) => void
  setError: (error: string | null) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  status: 'idle',
  transcript: [],
  isConnected: false,
  error: null,

  connect: () =>
    set({ isConnected: true, status: 'connected', error: null }),

  disconnect: () =>
    set({ isConnected: false, status: 'idle', sessionId: null }),

  setSessionId: (id) => set({ sessionId: id }),

  addMessage: (role, text) =>
    set((s) => ({
      transcript: [...s.transcript, { id: _messageId++, role, text }],
    })),

  setStatus: (status) => set({ status }),

  setError: (error) => set({ error }),
}))
