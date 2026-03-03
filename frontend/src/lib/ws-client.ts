/**
 * ws-client.ts — VeloVoice AI WebSocket client
 *
 * Manages the WebSocket connection to the VeloVoice backend, parses all
 * server messages via Zod, and reconnects with exponential backoff on
 * transient failures.
 *
 * Reconnect policy: max 5 attempts, 2 s base, 30 s cap, no reconnect on:
 *   - client-initiated disconnect (code 1000)
 *   - fatal server error (code 1011 / fatal:true error message)
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Server → Client Zod schemas
// ---------------------------------------------------------------------------

const SessionReadySchema = z.object({
  type: z.literal('session.ready'),
  session_id: z.string(),
})

const TranscriptPartialSchema = z.object({
  type: z.literal('transcript.partial'),
  text: z.string(),
})

const TranscriptFinalSchema = z.object({
  type: z.literal('transcript.final'),
  text: z.string(),
})

const ResponseEndSchema = z.object({
  type: z.literal('response.end'),
})

const ErrorSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  fatal: z.boolean(),
})

const ServerMessageSchema = z.discriminatedUnion('type', [
  SessionReadySchema,
  TranscriptPartialSchema,
  TranscriptFinalSchema,
  ResponseEndSchema,
  ErrorSchema,
])

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WsHandlers {
  onSessionReady(sessionId: string): void
  onTranscriptPartial(text: string): void
  onTranscriptFinal(text: string): void
  onResponseAudio(chunk: ArrayBuffer): void
  onResponseEnd(): void
  onError(code: string, message: string, fatal: boolean): void
}

// ---------------------------------------------------------------------------
// Reconnect constants (per plan §4: max 5 retries, 2 s base, 30 s cap)
// ---------------------------------------------------------------------------
const MAX_RETRIES = 5
const BASE_DELAY_MS = 2_000
const MAX_DELAY_MS = 30_000

export class WsClient {
  private _ws: WebSocket | null = null
  private _url: string = ''
  private _handlers: WsHandlers | null = null
  private _retries = 0
  private _intentionalClose = false // set true on client.disconnect()
  private _fatalError = false       // set true on fatal server error
  private _retryTimer: ReturnType<typeof setTimeout> | null = null

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  connect(url: string, handlers: WsHandlers): void {
    this._url = url
    this._handlers = handlers
    this._intentionalClose = false
    this._fatalError = false
    this._retries = 0
    this._openSocket()
  }

  sendAudioChunk(pcm: ArrayBuffer): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(pcm)
    }
  }

  sendAudioStop(): void {
    this._sendJson({ type: 'audio.stop' })
  }

  disconnect(): void {
    this._intentionalClose = true
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    this._sendJson({ type: 'session.end' })
    this._ws?.close(1000)
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private _openSocket(): void {
    const ws = new WebSocket(this._url)
    this._ws = ws

    ws.onopen = () => {
      this._sendJson({ type: 'session.start', config: {} })
    }

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer || ev.data instanceof Blob) {
        // Binary audio frame
        const buf =
          ev.data instanceof ArrayBuffer
            ? ev.data
            : (ev.data as Blob).arrayBuffer().then((b) =>
                this._handlers?.onResponseAudio(b),
              )
        if (buf instanceof ArrayBuffer) {
          this._handlers?.onResponseAudio(buf)
        }
        return
      }

      // Text JSON frame
      let parsed: unknown
      try {
        parsed = JSON.parse(ev.data as string)
      } catch {
        return
      }

      const result = ServerMessageSchema.safeParse(parsed)
      if (!result.success) return

      const msg = result.data
      switch (msg.type) {
        case 'session.ready':
          this._handlers?.onSessionReady(msg.session_id)
          break
        case 'transcript.partial':
          this._handlers?.onTranscriptPartial(msg.text)
          break
        case 'transcript.final':
          this._handlers?.onTranscriptFinal(msg.text)
          break
        case 'response.end':
          this._handlers?.onResponseEnd()
          break
        case 'error':
          if (msg.fatal) this._fatalError = true
          this._handlers?.onError(msg.code, msg.message, msg.fatal)
          break
      }
    }

    ws.onclose = () => {
      if (this._intentionalClose || this._fatalError) return
      if (this._retries >= MAX_RETRIES) return

      const delay = Math.min(BASE_DELAY_MS * 2 ** this._retries, MAX_DELAY_MS)
      this._retries++
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null
        this._openSocket()
      }, delay)
    }

    ws.onerror = () => {
      // Let onclose handle reconnect
    }
  }

  private _sendJson(payload: object): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(payload))
    }
  }
}
