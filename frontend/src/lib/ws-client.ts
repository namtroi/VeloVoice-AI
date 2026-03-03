// WS client stub — Phase 4
// TODO Phase 4: connect, sendAudioChunk, sendAudioStop, disconnect, Zod message parsing, reconnect with backoff

export interface WsHandlers {
  onSessionReady(sessionId: string): void
  onTranscriptPartial(text: string): void
  onTranscriptFinal(text: string): void
  onResponseAudio(chunk: ArrayBuffer): void
  onResponseEnd(): void
  onError(code: string, message: string, fatal: boolean): void
}

export class WsClient {
  connect(_url: string, _handlers: WsHandlers): void {
    // stub
  }

  sendAudioChunk(_pcm: ArrayBuffer): void {
    // stub
  }

  sendAudioStop(): void {
    // stub
  }

  disconnect(): void {
    // stub
  }
}
