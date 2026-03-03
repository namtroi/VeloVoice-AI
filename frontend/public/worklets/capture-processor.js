/**
 * capture-processor.js
 * 
 * AudioWorkletProcessor that reads float32 samples from the microphone,
 * converts them to Int16 (16-bit PCM), and posts them back to the main thread
 * in chunks of 4096 samples (~256ms at 16kHz, ~170ms at 24kHz).
 */

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.bufferSize = 4096
    this.buffer = new Int16Array(this.bufferSize)
    this.offset = 0
  }

  /**
   * Called by the browser audio thread to process incoming frames.
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0]
    
    // If no mic connected or disabled, input might be empty
    if (!input || !input.length) return true
    
    // We only care about the first channel (mono)
    const channel = input[0]

    for (let i = 0; i < channel.length; i++) {
      // Float32 -> Int16 conversion inline to avoid allocation in audio thread
      let sample = Math.max(-1, Math.min(1, channel[i]))
      this.buffer[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff

      // If chunk is full, post it to the main thread and reset
      if (this.offset >= this.bufferSize) {
        // We must copy the buffer because we're going to overwrite it
        const chunk = new Int16Array(this.buffer)
        this.port.postMessage(chunk.buffer, [chunk.buffer])
        this.offset = 0
      }
    }

    // Keep the processor alive
    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
