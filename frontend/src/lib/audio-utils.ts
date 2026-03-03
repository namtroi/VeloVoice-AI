/**
 * audio-utils.ts — VeloVoice AI
 *
 * PCM conversion utilities.
 * Browser AudioContext uses Float32Array (-1.0 to 1.0)
 * OpenAI Realtime API uses Int16Array (16-bit PCM, -32768 to 32767, LE)
 */

/**
 * Converts Float32Array to Int16Array (16-bit PCM)
 * Clamps values outside [-1.0, 1.0] to avoid integer overflow.
 */
export function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i])) // clamp
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16Array
}

/**
 * Converts Int16Array (16-bit PCM) to Float32Array
 */
export function int16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length)
  for (let i = 0; i < int16Array.length; i++) {
    const s = int16Array[i]
    float32Array[i] = s < 0 ? s / 0x8000 : s / 0x7fff
  }
  return float32Array
}
