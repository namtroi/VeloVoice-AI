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
      // Explicit asset paths — served by vite-plugin-static-copy from root
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'legacy',
      onSpeechStart: () => {
        onSpeechStart()
      },
      onSpeechEnd: () => {
        onSpeechEnd()
      },
      // Tuning parameters — calibrated for natural speech pauses
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.5,
      preSpeechPadMs: 200,
      redemptionMs: 600,
    })

    this._vad.start()
  }

  pause(): void {
    this._vad?.pause()
  }

  resume(): void {
    this._vad?.start()
  }

  async stop(): Promise<void> {
    if (this._vad) {
      await this._vad.pause()
      await this._vad.destroy()
      this._vad = null
    }
  }
}
