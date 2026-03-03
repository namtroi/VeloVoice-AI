/**
 * ws-client.test.ts — Phase 4 (TDD)
 *
 * Tests written BEFORE full implementation per TDD order.
 * Uses a mock WebSocket to simulate the server side.
 *
 * Run: npx vitest run src/tests/ws-client.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WsClient } from '../lib/ws-client'
import type { WsHandlers } from '../lib/ws-client'

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  url: string
  readyState = MockWebSocket.CONNECTING
  sentMessages: (string | ArrayBuffer)[] = []
  closeCode?: number

  onopen: (() => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onmessage: ((ev: { data: string | ArrayBuffer }) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string | ArrayBuffer) {
    this.sentMessages.push(data)
  }

  close(code = 1000) {
    this.closeCode = code
    this.readyState = MockWebSocket.CLOSING
    this.onclose?.({ code, reason: '' })
    this.readyState = MockWebSocket.CLOSED
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: object | ArrayBuffer) {
    const payload = data instanceof ArrayBuffer ? data : JSON.stringify(data)
    this.onmessage?.({ data: payload })
  }

  simulateClose(code = 1000) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason: '' })
  }

  simulateError() {
    this.onerror?.(new Event('error'))
  }
}

// Replace global WebSocket with the mock
beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function latestWs(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1)
  if (!ws) throw new Error('No WebSocket created')
  return ws
}

function makeHandlers(): WsHandlers & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {}
  const track =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name] ??= []
      calls[name].push(args)
    }
  return {
    calls,
    onSessionReady: vi.fn(track('onSessionReady')),
    onTranscriptPartial: vi.fn(track('onTranscriptPartial')),
    onTranscriptFinal: vi.fn(track('onTranscriptFinal')),
    onResponseAudio: vi.fn(track('onResponseAudio')),
    onResponseEnd: vi.fn(track('onResponseEnd')),
    onError: vi.fn(track('onError')),
  }
}

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe('WsClient — connect()', () => {
  it('opens a WebSocket to the given URL', () => {
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', makeHandlers())
    expect(latestWs().url).toBe('ws://localhost:8000/ws')
  })

  it('sends session.start on WebSocket open', () => {
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', makeHandlers())
    latestWs().simulateOpen()
    const msg = JSON.parse(latestWs().sentMessages[0] as string)
    expect(msg.type).toBe('session.start')
  })

  it('sends session.start with default config', () => {
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', makeHandlers())
    latestWs().simulateOpen()
    const msg = JSON.parse(latestWs().sentMessages[0] as string)
    expect(msg.config).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Incoming message handlers
// ---------------------------------------------------------------------------

describe('WsClient — message routing', () => {
  function setup() {
    const client = new WsClient()
    const handlers = makeHandlers()
    client.connect('ws://localhost:8000/ws', handlers)
    latestWs().simulateOpen()
    return { client, handlers, ws: latestWs() }
  }

  it('calls onSessionReady when server sends session.ready', () => {
    const { handlers, ws } = setup()
    ws.simulateMessage({ type: 'session.ready', session_id: 'sess-1' })
    expect(handlers.onSessionReady).toHaveBeenCalledWith('sess-1')
  })

  it('calls onTranscriptPartial with text', () => {
    const { handlers, ws } = setup()
    ws.simulateMessage({ type: 'transcript.partial', text: 'hell' })
    expect(handlers.onTranscriptPartial).toHaveBeenCalledWith('hell')
  })

  it('calls onTranscriptFinal with text', () => {
    const { handlers, ws } = setup()
    ws.simulateMessage({ type: 'transcript.final', text: 'hello world' })
    expect(handlers.onTranscriptFinal).toHaveBeenCalledWith('hello world')
  })

  it('calls onResponseEnd on response.end', () => {
    const { handlers, ws } = setup()
    ws.simulateMessage({ type: 'response.end' })
    expect(handlers.onResponseEnd).toHaveBeenCalled()
  })

  it('calls onError with code, message, fatal=false for non-fatal errors', () => {
    const { handlers, ws } = setup()
    ws.simulateMessage({ type: 'error', code: 'INVALID_MESSAGE_TYPE', message: 'bad msg', fatal: false })
    expect(handlers.onError).toHaveBeenCalledWith('INVALID_MESSAGE_TYPE', 'bad msg', false)
  })

  it('calls onError with fatal=true for fatal errors', () => {
    const { handlers, ws } = setup()
    ws.simulateMessage({ type: 'error', code: 'INTERNAL_ERROR', message: 'boom', fatal: true })
    expect(handlers.onError).toHaveBeenCalledWith('INTERNAL_ERROR', 'boom', true)
  })

  it('ignores unknown message types without throwing', () => {
    const { ws } = setup()
    expect(() => ws.simulateMessage({ type: 'unknown.future.event' })).not.toThrow()
  })

  it('forwards binary ArrayBuffer frames to onResponseAudio', () => {
    const { handlers, ws } = setup()
    const audio = new ArrayBuffer(8)
    ws.simulateMessage(audio)
    expect(handlers.onResponseAudio).toHaveBeenCalledWith(audio)
  })
})

// ---------------------------------------------------------------------------
// sendAudioChunk() / sendAudioStop()
// ---------------------------------------------------------------------------

describe('WsClient — sendAudioChunk() / sendAudioStop()', () => {
  function setup() {
    const client = new WsClient()
    const handlers = makeHandlers()
    client.connect('ws://localhost:8000/ws', handlers)
    latestWs().simulateOpen()
    return { client, ws: latestWs() }
  }

  it('sendAudioChunk sends binary frame', () => {
    const { client, ws } = setup()
    const buf = new ArrayBuffer(16)
    client.sendAudioChunk(buf)
    expect(ws.sentMessages).toContain(buf)
  })

  it('sendAudioStop sends audio.stop JSON', () => {
    const { client, ws } = setup()
    client.sendAudioStop()
    const last = JSON.parse(ws.sentMessages.at(-1) as string)
    expect(last.type).toBe('audio.stop')
  })
})

// ---------------------------------------------------------------------------
// disconnect()
// ---------------------------------------------------------------------------

describe('WsClient — disconnect()', () => {
  it('sends session.end before closing', () => {
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', makeHandlers())
    const ws = latestWs()
    ws.simulateOpen()
    client.disconnect()
    const msgs = ws.sentMessages.map((m) =>
      typeof m === 'string' ? JSON.parse(m) : m,
    )
    expect(msgs.find((m) => m.type === 'session.end')).toBeDefined()
  })

  it('closes the WebSocket', () => {
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', makeHandlers())
    const ws = latestWs()
    ws.simulateOpen()
    client.disconnect()
    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
  })
})

// ---------------------------------------------------------------------------
// Reconnect with exponential backoff
// ---------------------------------------------------------------------------

describe('WsClient — reconnect on transient close', () => {
  it('reconnects after non-fatal WS close (1001)', () => {
    vi.useFakeTimers()
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', makeHandlers())
    latestWs().simulateOpen()
    latestWs().simulateClose(1001) // transient
    // No immediate reconnect
    expect(MockWebSocket.instances).toHaveLength(1)
    // After first backoff (2 s)
    vi.advanceTimersByTime(2100)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('does NOT reconnect after client-initiated disconnect (1000)', () => {
    vi.useFakeTimers()
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', makeHandlers())
    latestWs().simulateOpen()
    client.disconnect() // 1000 close
    vi.advanceTimersByTime(5000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('does NOT reconnect after fatal error (1011)', () => {
    const handlers = makeHandlers()
    vi.useFakeTimers()
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', handlers)
    latestWs().simulateOpen()
    latestWs().simulateMessage({ type: 'error', code: 'INTERNAL_ERROR', message: 'fatal', fatal: true })
    latestWs().simulateClose(1011)
    vi.advanceTimersByTime(5000)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('caps retries at 5 attempts', () => {
    vi.useFakeTimers()
    const client = new WsClient()
    client.connect('ws://localhost:8000/ws', makeHandlers())

    // Simulate failure on each socket: open → close(1001), let backoff fire
    // We do this MAX_RETRIES + 1 times (initial + 5 retries = 6 total sockets max)
    for (let i = 0; i < 5; i++) {
      latestWs().simulateOpen()
      latestWs().simulateClose(1001)
      vi.advanceTimersByTime(40_000) // advance past any backoff
    }

    const countAfterExhaustion = MockWebSocket.instances.length
    // One more close should trigger no new socket
    latestWs().simulateClose(1001)
    vi.advanceTimersByTime(40_000)

    expect(MockWebSocket.instances.length).toBe(countAfterExhaustion)
    expect(MockWebSocket.instances.length).toBeLessThanOrEqual(5 + 1)
  })
})
