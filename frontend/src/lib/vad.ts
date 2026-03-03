/**
 * vad.ts — VeloVoice AI
 *
 * Voice Activity Detection using @ricky0123/vad-web.
 * Listens to the microphone and triggers onSpeechStart/onSpeechEnd callbacks.
 */

import { MicVAD } from '@ricky0123/vad-web'

export class VadController {
  private _vad: MicVAD | null = null

  async start(
    onSpeechStart: () => void,
    onSpeechEnd: () => void,
  ): Promise<void> {
    if (this._vad) return

    this._vad = await MicVAD.new({
      onSpeechStart: () => {
        onSpeechStart()
      },
      onSpeechEnd: (audio: Float32Array) => {
        onSpeechEnd()
      },
      // Tuning parameters could be adjusted here based on real-world testing
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.8,
      preSpeechPadFrames: 1,
      redemptionFrames: 5,
    })

    this._vad.start()
  }

  stop(): void {
    if (this._vad) {
      this._vad.pause()
      this._vad.destroy()
      this._vad = null
    }
  }
}
