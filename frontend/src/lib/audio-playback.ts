/**
 * audio-playback.ts — VeloVoice AI
 *
 * Manages playback of incoming PCM audio chunks from OpenAI.
 * Uses an AudioContext and a custom playback-processor AudioWorklet.
 */

import { int16ToFloat32 } from './audio-utils'

export class AudioPlayback {
  private _context: AudioContext | null = null
  private _processor: AudioWorkletNode | null = null
  private _initPromise: Promise<void> | null = null

  constructor() {
    this._initPromise = this._init()
  }

  private async _init() {
    // OpenAI responds with same sample rate we send (24000)
    this._context = new AudioContext({ sampleRate: 24000 })
    
    // Resume context if browser suspended it (needs user interaction first)
    if (this._context.state === 'suspended') {
      await this._context.resume()
    }

    await this._context.audioWorklet.addModule('/worklets/playback-processor.js')
    
    this._processor = new AudioWorkletNode(this._context, 'playback-processor')
    this._processor.connect(this._context.destination)
  }

  async push(chunk: ArrayBuffer): Promise<void> {
    await this._initPromise
    
    // Chunk is Int16LE buffer from WebSocket. Convert to Float32 for Web Audio.
    const int16 = new Int16Array(chunk)
    const float32 = int16ToFloat32(int16)

    // Send the converted chunk to the processor
    this._processor?.port.postMessage(
      { type: 'chunk', buffer: float32.buffer }, 
      [float32.buffer]
    )
  }

  async drain(): Promise<void> {
    await this._initPromise
    this._processor?.port.postMessage({ type: 'drain' })
  }

  stop(): void {
    if (this._processor) {
      this._processor.disconnect()
      this._processor = null
    }
    if (this._context) {
      this._context.close()
      this._context = null
    }
  }
}
