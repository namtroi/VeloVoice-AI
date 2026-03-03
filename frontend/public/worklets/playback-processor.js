/**
 * playback-processor.js
 * 
 * AudioWorkletProcessor that receives float32 audio chunks from the main thread,
 * stores them in an internal ring-buffer, and plays them smoothly to the speakers.
 */

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // 5 seconds at 24000Hz = 120000 samples buffer
    this.capacity = 120000
    this.buffer = new Float32Array(this.capacity)
    this.readIndex = 0
    this.writeIndex = 0
    this.framesAvailable = 0

    // Listen for incoming chunks from the main thread
    this.port.onmessage = (event) => {
      const type = event.data.type
      if (type === 'chunk') {
        const float32Array = new Float32Array(event.data.buffer)
        this._push(float32Array)
      } else if (type === 'drain') {
        this._drain()
      }
    }
  }

  /**
   * Inline ring-buffer push to avoid function calls and closures in hot path
   */
  _push(data) {
    const dataLen = data.length
    if (dataLen >= this.capacity) {
      this.buffer.set(data.subarray(dataLen - this.capacity))
      this.writeIndex = 0
      this.readIndex = 0
      this.framesAvailable = this.capacity
      return
    }

    const spaceToBufferEnd = this.capacity - this.writeIndex
    if (dataLen <= spaceToBufferEnd) {
      this.buffer.set(data, this.writeIndex)
    } else {
      this.buffer.set(data.subarray(0, spaceToBufferEnd), this.writeIndex)
      this.buffer.set(data.subarray(spaceToBufferEnd), 0)
    }

    this.writeIndex = (this.writeIndex + dataLen) % this.capacity
    this.framesAvailable += dataLen

    if (this.framesAvailable > this.capacity) {
      const overflow = this.framesAvailable - this.capacity
      this.readIndex = (this.readIndex + overflow) % this.capacity
      this.framesAvailable = this.capacity
    }
  }

  _drain() {
    this.readIndex = 0
    this.writeIndex = 0
    this.framesAvailable = 0
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0]
    if (!output || !output.length) return true
    
    // Mono output only
    const channel = output[0]
    const toRead = channel.length

    // If we have underflow (no data left), fill with zeroes (silence)
    if (this.framesAvailable === 0) {
      channel.fill(0)
      return true
    }

    // Pull from the ring buffer
    const actualRead = Math.min(toRead, this.framesAvailable)
    const tillBufferEnd = this.capacity - this.readIndex

    if (actualRead <= tillBufferEnd) {
      channel.set(this.buffer.subarray(this.readIndex, this.readIndex + actualRead))
    } else {
      channel.set(this.buffer.subarray(this.readIndex, this.capacity), 0)
      channel.set(this.buffer.subarray(0, actualRead - tillBufferEnd), tillBufferEnd)
    }

    this.readIndex = (this.readIndex + actualRead) % this.capacity
    this.framesAvailable -= actualRead

    // If we didn't have enough data to fill the channel, fill the rest with silence
    if (actualRead < toRead) {
      channel.fill(0, actualRead)
    }

    return true
  }
}

registerProcessor('playback-processor', PlaybackProcessor)
