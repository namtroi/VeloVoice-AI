/**
 * audio-capture.ts — VeloVoice AI
 *
 * Acquires microphone access, creates a 24kHz AudioContext, and runs
 * the capture-processor AudioWorklet to extract Int16 PCM chunks.
 */

export class AudioCapture {
  private _context: AudioContext | null = null
  private _stream: MediaStream | null = null
  private _source: MediaStreamAudioSourceNode | null = null
  private _processor: AudioWorkletNode | null = null
  private _vadActive = false

  async start(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    if (this._context) return

    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    // OpenAI Realtime requires 24kHz (or 16kHz) 16-bit PCM.
    // They recommend 24000 for gpt-4o-realtime
    this._context = new AudioContext({ sampleRate: 24000 })
    
    // Load the worklet from public/
    await this._context.audioWorklet.addModule('/worklets/capture-processor.js')

    this._source = this._context.createMediaStreamSource(this._stream)
    this._processor = new AudioWorkletNode(this._context, 'capture-processor')

    this._processor.port.onmessage = (event) => {
      // event.data is an Int16Array buffer
      if (this._vadActive) {
        onChunk(event.data)
      }
    }

    this._source.connect(this._processor)
    // The processor needs to be connected to destination to process data in some browsers
    // but doing so directly would cause microphone feedback. We rely on the implicit
    // keep-alive of `return true` in process(). If suspended, we log it.
    if (this._context.state === 'suspended') {
      await this._context.resume()
    }
  }

  stop(): void {
    if (this._processor) {
      this._processor.disconnect()
      this._processor = null
    }
    if (this._source) {
      this._source.disconnect()
      this._source = null
    }
    if (this._context) {
      this._context.close()
      this._context = null
    }
    if (this._stream) {
      this._stream.getTracks().forEach((track) => track.stop())
      this._stream = null
    }
    this._vadActive = false
  }

  setVadActive(active: boolean): void {
    this._vadActive = active
  }
}
