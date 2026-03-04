/**
 * transcript-panel.test.ts
 *
 * Verifies that messages produced by the session store carry stable numeric IDs
 * suitable for use as React keys.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionStore } from '../stores/session-store'

function resetStore() {
  useSessionStore.setState({ transcript: [] })
}

describe('Message stable keys (Fix 14)', () => {
  beforeEach(resetStore)

  it('addMessage produces messages with numeric id field', () => {
    useSessionStore.getState().addMessage('user', 'Hello')
    useSessionStore.getState().addMessage('assistant', 'Hi')
    const { transcript } = useSessionStore.getState()
    expect(transcript).toHaveLength(2)
    expect(typeof transcript[0].id).toBe('number')
    expect(typeof transcript[1].id).toBe('number')
  })

  it('each message receives a unique id', () => {
    useSessionStore.getState().addMessage('user', 'Hello')
    useSessionStore.getState().addMessage('assistant', 'Hi')
    const { transcript } = useSessionStore.getState()
    expect(transcript[0].id).not.toBe(transcript[1].id)
  })

  it('ids are stable across store resets (monotonically increasing)', () => {
    useSessionStore.getState().addMessage('user', 'A')
    const firstId = useSessionStore.getState().transcript[0].id
    resetStore()
    useSessionStore.getState().addMessage('user', 'B')
    const secondId = useSessionStore.getState().transcript[0].id
    // After reset, new id must still be unique (greater than the previous one)
    expect(secondId).toBeGreaterThan(firstId)
  })
})
