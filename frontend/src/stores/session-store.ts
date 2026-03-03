// Session store stub — Phase 4
// TODO Phase 4: full Zustand store with connect/disconnect/addMessage/setState/setError actions

import { create } from 'zustand'

type SessionStatus = 'idle' | 'connected' | 'listening' | 'processing' | 'speaking'

interface Message {
  role: 'user' | 'assistant'
  text: string
}

interface SessionState {
  sessionId: string | null
  status: SessionStatus
  transcript: Message[]
  isConnected: boolean
  error: string | null

  connect: () => void
  disconnect: () => void
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

  connect: () => set({ isConnected: true, status: 'connected', error: null }),
  disconnect: () => set({ isConnected: false, status: 'idle', sessionId: null }),
  addMessage: (role, text) =>
    set((s) => ({ transcript: [...s.transcript, { role, text }] })),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
}))
