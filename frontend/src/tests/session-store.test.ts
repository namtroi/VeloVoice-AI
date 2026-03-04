/**
 * session-store.test.ts — Phase 4 (TDD)
 *
 * Tests written BEFORE implementation per TDD order.
 * Run: npx vitest run src/tests/session-store.test.ts
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionStore } from '../stores/session-store'

// Reset Zustand store state between tests
function resetStore() {
  useSessionStore.setState({
    sessionId: null,
    status: 'idle',
    transcript: [],
    isConnected: false,
    error: null,
  })
}

describe('useSessionStore — initial state', () => {
  beforeEach(resetStore)

  it('starts with sessionId = null', () => {
    expect(useSessionStore.getState().sessionId).toBeNull()
  })

  it('starts with status = idle', () => {
    expect(useSessionStore.getState().status).toBe('idle')
  })

  it('starts with empty transcript', () => {
    expect(useSessionStore.getState().transcript).toEqual([])
  })

  it('starts not connected', () => {
    expect(useSessionStore.getState().isConnected).toBe(false)
  })

  it('starts with no error', () => {
    expect(useSessionStore.getState().error).toBeNull()
  })
})

describe('useSessionStore — connect()', () => {
  beforeEach(resetStore)

  it('sets isConnected to true', () => {
    useSessionStore.getState().connect()
    expect(useSessionStore.getState().isConnected).toBe(true)
  })

  it('sets status to connected', () => {
    useSessionStore.getState().connect()
    expect(useSessionStore.getState().status).toBe('connected')
  })

  it('clears any existing error', () => {
    useSessionStore.setState({ error: 'previous error' })
    useSessionStore.getState().connect()
    expect(useSessionStore.getState().error).toBeNull()
  })
})

describe('useSessionStore — disconnect()', () => {
  beforeEach(resetStore)

  it('sets isConnected to false', () => {
    useSessionStore.setState({ isConnected: true })
    useSessionStore.getState().disconnect()
    expect(useSessionStore.getState().isConnected).toBe(false)
  })

  it('resets status to idle', () => {
    useSessionStore.setState({ status: 'connected' })
    useSessionStore.getState().disconnect()
    expect(useSessionStore.getState().status).toBe('idle')
  })

  it('clears sessionId', () => {
    useSessionStore.setState({ sessionId: 'sess-123' })
    useSessionStore.getState().disconnect()
    expect(useSessionStore.getState().sessionId).toBeNull()
  })
})

describe('useSessionStore — setSessionId()', () => {
  beforeEach(resetStore)

  it('stores the session ID', () => {
    useSessionStore.getState().setSessionId('sess-abc')
    expect(useSessionStore.getState().sessionId).toBe('sess-abc')
  })

  it('can overwrite an existing session ID', () => {
    useSessionStore.setState({ sessionId: 'old' })
    useSessionStore.getState().setSessionId('new')
    expect(useSessionStore.getState().sessionId).toBe('new')
  })
})

describe('useSessionStore — addMessage()', () => {
  beforeEach(resetStore)

  it('appends a user message', () => {
    useSessionStore.getState().addMessage('user', 'Hello')
    const { transcript } = useSessionStore.getState()
    expect(transcript).toHaveLength(1)
    // toMatchObject — id field is present but value is not checked here
    expect(transcript[0]).toMatchObject({ role: 'user', text: 'Hello' })
  })

  it('appends an assistant message', () => {
    useSessionStore.getState().addMessage('assistant', 'Hi there!')
    const { transcript } = useSessionStore.getState()
    expect(transcript[0]).toMatchObject({ role: 'assistant', text: 'Hi there!' })
  })

  it('addMessage with role assistant stores assistant role', () => {
    const { addMessage } = useSessionStore.getState()
    addMessage('assistant', 'Hello from AI')
    const { transcript } = useSessionStore.getState()
    expect(transcript.at(-1)?.role).toBe('assistant')
  })

  it('each message has a unique numeric id', () => {
    useSessionStore.getState().addMessage('user', 'A')
    useSessionStore.getState().addMessage('assistant', 'B')
    const { transcript } = useSessionStore.getState()
    expect(typeof transcript[0].id).toBe('number')
    expect(transcript[0].id).not.toBe(transcript[1].id)
  })

  it('preserves message order across multiple calls', () => {
    useSessionStore.getState().addMessage('user', 'First')
    useSessionStore.getState().addMessage('assistant', 'Second')
    useSessionStore.getState().addMessage('user', 'Third')
    const { transcript } = useSessionStore.getState()
    expect(transcript.map((m) => m.text)).toEqual(['First', 'Second', 'Third'])
  })

  it('does not mutate previous messages', () => {
    useSessionStore.getState().addMessage('user', 'A')
    const snapshot = useSessionStore.getState().transcript
    useSessionStore.getState().addMessage('user', 'B')
    // snapshot still has only 1 item
    expect(snapshot).toHaveLength(1)
  })
})

describe('useSessionStore — setStatus()', () => {
  beforeEach(resetStore)

  const states = ['idle', 'connected', 'listening', 'processing', 'speaking'] as const

  for (const s of states) {
    it(`can be set to ${s}`, () => {
      useSessionStore.getState().setStatus(s)
      expect(useSessionStore.getState().status).toBe(s)
    })
  }
})

describe('useSessionStore — setError()', () => {
  beforeEach(resetStore)

  it('sets an error string', () => {
    useSessionStore.getState().setError('Something went wrong')
    expect(useSessionStore.getState().error).toBe('Something went wrong')
  })

  it('clears error when passed null', () => {
    useSessionStore.setState({ error: 'old error' })
    useSessionStore.getState().setError(null)
    expect(useSessionStore.getState().error).toBeNull()
  })
})

describe('useSessionStore — state transitions', () => {
  beforeEach(resetStore)

  it('typical session lifecycle: idle → connected → listening → processing → connected', () => {
    const s = useSessionStore.getState()
    expect(s.status).toBe('idle')
    s.connect()
    expect(useSessionStore.getState().status).toBe('connected')
    useSessionStore.getState().setStatus('listening')
    expect(useSessionStore.getState().status).toBe('listening')
    useSessionStore.getState().setStatus('processing')
    expect(useSessionStore.getState().status).toBe('processing')
    useSessionStore.getState().setStatus('connected')
    expect(useSessionStore.getState().status).toBe('connected')
  })

  it('disconnect after connect returns to idle', () => {
    useSessionStore.getState().connect()
    useSessionStore.setState({ sessionId: 'sess-1' })
    useSessionStore.getState().disconnect()
    const st = useSessionStore.getState()
    expect(st.status).toBe('idle')
    expect(st.isConnected).toBe(false)
    expect(st.sessionId).toBeNull()
  })
})
