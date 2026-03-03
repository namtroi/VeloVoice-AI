/**
 * ring-buffer.ts — VeloVoice AI
 *
 * A simple lock-free(ish) ring buffer for Float32Array audio data.
 * Used by the playback system to buffer incoming WebSocket audio chunks
 * and provide gapless streaming to the AudioWorklet.
 */

export class RingBuffer {
  private _buffer: Float32Array
  private _capacity: number
  private _readIndex = 0
  private _writeIndex = 0
  private _framesAvailable = 0

  constructor(capacity: number) {
    this._capacity = capacity
    this._buffer = new Float32Array(capacity)
  }

  get capacity(): number {
    return this._capacity
  }

  availableFrames(): number {
    return this._framesAvailable
  }

  availableSpaces(): number {
    return this._capacity - this._framesAvailable
  }

  clear(): void {
    this._readIndex = 0
    this._writeIndex = 0
    this._framesAvailable = 0
  }

  /**
   * Pushes float32 data into the buffer.
   * If the data is larger than the capacity, the oldest data is overwritten
   * (the read pointer is advanced).
   */
  push(data: Float32Array): void {
    const dataLen = data.length

    if (dataLen >= this._capacity) {
      // Data is larger than the whole buffer; just keep the tail
      const tail = data.subarray(dataLen - this._capacity)
      this._buffer.set(tail)
      this._writeIndex = 0
      this._readIndex = 0
      this._framesAvailable = this._capacity
      return
    }

    // Normal push
    const spaceToBufferEnd = this._capacity - this._writeIndex
    if (dataLen <= spaceToBufferEnd) {
      // Fits without wrapping
      this._buffer.set(data, this._writeIndex)
    } else {
      // Needs wrap-around
      this._buffer.set(data.subarray(0, spaceToBufferEnd), this._writeIndex)
      this._buffer.set(data.subarray(spaceToBufferEnd), 0)
    }

    this._writeIndex = (this._writeIndex + dataLen) % this._capacity
    this._framesAvailable += dataLen

    // Check overflow
    if (this._framesAvailable > this._capacity) {
      const overflow = this._framesAvailable - this._capacity
      this._readIndex = (this._readIndex + overflow) % this._capacity
      this._framesAvailable = this._capacity
    }
  }

  /**
   * Pulls up to `dest.length` frames into `dest`.
   * Returns the actual number of frames read (may be less if underflow).
   */
  pull(dest: Float32Array): number {
    if (this._framesAvailable === 0) return 0

    const toRead = Math.min(dest.length, this._framesAvailable)
    const tillBufferEnd = this._capacity - this._readIndex

    if (toRead <= tillBufferEnd) {
      // Single continuous read
      dest.set(this._buffer.subarray(this._readIndex, this._readIndex + toRead))
    } else {
      // Wrapped read
      dest.set(this._buffer.subarray(this._readIndex, this._capacity), 0)
      dest.set(this._buffer.subarray(0, toRead - tillBufferEnd), tillBufferEnd)
    }

    this._readIndex = (this._readIndex + toRead) % this._capacity
    this._framesAvailable -= toRead

    return toRead
  }
}
