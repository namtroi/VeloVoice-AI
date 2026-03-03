/**
 * audio-utils.test.ts — Phase 5 (TDD)
 *
 * Tests for PCM format conversions between Browser (Float32) and OpenAI (Int16 LE)
 */

import { describe, expect, it } from 'vitest'
import { float32ToInt16, int16ToFloat32 } from '../lib/audio-utils'

describe('audio-utils: float32ToInt16', () => {
  it('converts max amplitude (1.0) to 32767', () => {
    const input = new Float32Array([1.0])
    const output = float32ToInt16(input)
    expect(output.length).toBe(1)
    expect(output[0]).toBe(32767)
  })

  it('converts min amplitude (-1.0) to -32768', () => {
    const input = new Float32Array([-1.0])
    const output = float32ToInt16(input)
    expect(output[0]).toBe(-32768)
  })

  it('converts zero to 0', () => {
    const input = new Float32Array([0.0])
    const output = float32ToInt16(input)
    expect(output[0]).toBe(0)
  })

  it('clamps values > 1.0 to 32767', () => {
    const input = new Float32Array([1.5, 100.0])
    const output = float32ToInt16(input)
    expect(output[0]).toBe(32767)
    expect(output[1]).toBe(32767)
  })

  it('clamps values < -1.0 to -32768', () => {
    const input = new Float32Array([-1.5, -100.0])
    const output = float32ToInt16(input)
    expect(output[0]).toBe(-32768)
    expect(output[1]).toBe(-32768)
  })

  it('handles fractional intermediate values correctly', () => {
    const input = new Float32Array([0.5, -0.5])
    const output = float32ToInt16(input)
    // 0.5 * 32767 = 16383.5 -> 16383 (or 16384 depending on rounding, both acceptable)
    // -0.5 * 32768 = -16384
    expect(output[0]).toBe(16383)
    expect(output[1]).toBe(-16384)
  })
})

describe('audio-utils: int16ToFloat32', () => {
  it('converts max Int16 (32767) to ~1.0', () => {
    const input = new Int16Array([32767])
    const output = int16ToFloat32(input)
    // 32767 / 32768 = 0.999969482421875
    expect(output[0]).toBeCloseTo(1.0, 4)
  })

  it('converts min Int16 (-32768) to -1.0', () => {
    const input = new Int16Array([-32768])
    const output = int16ToFloat32(input)
    expect(output[0]).toBe(-1.0)
  })

  it('converts zero to 0', () => {
    const input = new Int16Array([0])
    const output = int16ToFloat32(input)
    expect(output[0]).toBe(0)
  })

  it('round-trips Int16 -> Float32 -> Int16 correctly', () => {
    const original = new Int16Array([-32768, -16000, 0, 16000, 32767])
    const float = int16ToFloat32(original)
    const backToInt16 = float32ToInt16(float)
    
    // Note: 32767 -> float -> gets slightly altered, might round to 32766 or 32767 depending on impl
    // It should be within 1 bit of original
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(original[i] - backToInt16[i])).toBeLessThanOrEqual(1)
    }
  })
})
