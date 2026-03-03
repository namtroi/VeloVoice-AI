// Audio playback stub — Phase 5
// TODO Phase 5: ring buffer, AudioWorkletNode playback-processor, gapless playback, drain on response.end

export class AudioPlayback {
  push(_chunk: ArrayBuffer): void {
    // stub
  }

  drain(): void {
    // stub — call on response.end
  }

  stop(): void {
    // stub
  }
}
