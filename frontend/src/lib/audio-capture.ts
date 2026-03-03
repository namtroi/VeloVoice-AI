// Audio capture stub — Phase 5
// TODO Phase 5: getUserMedia, AudioContext 16kHz, AudioWorkletNode, Float32→Int16 conversion
// Only sends while vadActive = true; chunk size 4096 samples (~256ms)

export class AudioCapture {
  async start(_onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    // stub
  }

  stop(): void {
    // stub
  }

  setVadActive(_active: boolean): void {
    // stub
  }
}
