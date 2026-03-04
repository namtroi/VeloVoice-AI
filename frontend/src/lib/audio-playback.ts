/**
 * audio-playback.ts — VeloVoice AI
 *
 * Manages playback of incoming PCM audio chunks from OpenAI.
 * Uses an AudioContext and a custom playback-processor AudioWorklet.
 *
 * OpenAI sends audio at 24000Hz PCM16. If the browser doesn't support
 * creating an AudioContext at 24kHz, we use the browser's built-in
 * OfflineAudioContext to resample each chunk to the native rate.
 */

import { int16ToFloat32 } from './audio-utils'

const OPENAI_SAMPLE_RATE = 24000

export class AudioPlayback {
  private _context: AudioContext | null = null
  private _processor: AudioWorkletNode | null = null
  private _initPromise: Promise<void> | null = null
  private _resampleRatio = 1
  private _needsResample = false

  constructor() {
    this._initPromise = this._init()
  }

  private async _init() {
    // Try to create context at OpenAI's native 24kHz.
    // If the browser ignores our request and uses a different rate,
    // we'll detect that and resample each chunk accordingly.
    this._context = new AudioContext({ sampleRate: OPENAI_SAMPLE_RATE })

    const actualRate = this._context.sampleRate
    this._resampleRatio = actualRate / OPENAI_SAMPLE_RATE
    this._needsResample = Math.abs(this._resampleRatio - 1) > 0.01

    if (this._needsResample) {
      console.log(
        `[AudioPlayback] Browser rate ${actualRate}Hz != ${OPENAI_SAMPLE_RATE}Hz, resampling enabled (ratio ${this._resampleRatio.toFixed(2)})`
      )
    }

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
    const sourceFloat32 = int16ToFloat32(int16)

    // Resample if the browser didn't give us a 24kHz context
    const final = this._needsResample
      ? await this._resampleWithOffline(sourceFloat32)
      : sourceFloat32

    // Send the chunk to the processor worklet
    this._processor?.port.postMessage(
      { type: 'chunk', buffer: final.buffer },
      [final.buffer]
    )
  }

  /**
   * Signal that no more chunks are coming for this response.
   * The worklet will play out any remaining buffered audio.
   */
  async flush(): Promise<void> {
    await this._initPromise
    // Nothing to do — the worklet will naturally drain its buffer.
    // We just signal the main thread that streaming is done.
  }

  stop(): void {
    if (this._processor) {
      this._processor.port.postMessage({ type: 'drain' })
      this._processor.disconnect()
      this._processor = null
    }
    if (this._context) {
      this._context.close()
      this._context = null
    }
  }

  /**
   * Use the browser's OfflineAudioContext for high-quality resampling.
   * This leverages the browser's native audio decoder instead of manual interpolation.
   */
  private async _resampleWithOffline(source: Float32Array): Promise<Float32Array> {
    const outputLength = Math.round(source.length * this._resampleRatio)
    const targetRate = this._context!.sampleRate

    const offline = new OfflineAudioContext(1, outputLength, targetRate)
    const buf = offline.createBuffer(1, source.length, OPENAI_SAMPLE_RATE)
    buf.getChannelData(0).set(source)

    const src = offline.createBufferSource()
    src.buffer = buf
    src.connect(offline.destination)
    src.start()

    const rendered = await offline.startRendering()
    return rendered.getChannelData(0)
  }
}
