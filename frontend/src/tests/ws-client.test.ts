// WsClient tests stub — Phase 4
// TODO Phase 4: mock WS server, verify message round-trips, state transitions

import { describe, it } from 'vitest'

describe('WsClient', () => {
  it.todo('connects and sends session.start')
  it.todo('handles session.ready message')
  it.todo('handles transcript.partial message')
  it.todo('handles transcript.final message')
  it.todo('handles response.end message')
  it.todo('handles error message (non-fatal)')
  it.todo('handles fatal error and closes WS')
  it.todo('reconnects with exponential backoff')
})
