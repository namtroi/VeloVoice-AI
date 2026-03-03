/**
 * ring-buffer.test.ts — Phase 5 (TDD)
 *
 * Tests for the gapless playback buffer.
 * A RingBuffer must support push (write) and pull (read) operations
 * up to a max capacity, overwriting or blocking as configured.
 */

import { describe, expect, it } from 'vitest'
import { RingBuffer } from '../lib/ring-buffer'

describe('RingBuffer', () => {
  it('initializes with given capacity', () => {
    const rb = new RingBuffer(100)
    expect(rb.capacity).toBe(100)
    expect(rb.availableSpaces()).toBe(100)
    expect(rb.availableFrames()).toBe(0)
  })

  it('pushes data and updates available counts', () => {
    const rb = new RingBuffer(100)
    const data = new Float32Array([1, 2, 3])
    rb.push(data)
    expect(rb.availableSpaces()).toBe(97)
    expect(rb.availableFrames()).toBe(3)
  })

  it('pulls data correctly', () => {
    const rb = new RingBuffer(10)
    rb.push(new Float32Array([1, 2, 3]))

    const dest = new Float32Array(2)
    const pulled = rb.pull(dest)
    
    expect(pulled).toBe(2)
    expect(dest[0]).toBe(1)
    expect(dest[1]).toBe(2)
    expect(rb.availableFrames()).toBe(1)
  })

  it('wraps around the end of the buffer on push', () => {
    const rb = new RingBuffer(5)
    // Push 3
    rb.push(new Float32Array([1, 2, 3]))
    // Pull 2 (read_ptr now at 2)
    rb.pull(new Float32Array(2))
    // Push 3 more (write_ptr goes 3 -> 4 -> 0 -> 1)
    rb.push(new Float32Array([4, 5, 6]))
    
    expect(rb.availableFrames()).toBe(4) // 1 remaining from first push + 3 new

    // Pluck all 4
    const out = new Float32Array(4)
    rb.pull(out)
    expect(Array.from(out)).toEqual([3, 4, 5, 6])
  })

  it('silently drops oldest data if pushed beyond capacity (overflow)', () => {
    const rb = new RingBuffer(4)
    rb.push(new Float32Array([1, 2, 3, 4, 5, 6])) // Overflows capacity of 4
    
    expect(rb.availableFrames()).toBe(4) // capped
    const out = new Float32Array(4)
    rb.pull(out)
    
    // Kept the LAST 4: 3, 4, 5, 6
    expect(Array.from(out)).toEqual([3, 4, 5, 6])
  })

  it('pulls only as much as available if requested size > available (underflow)', () => {
    const rb = new RingBuffer(10)
    rb.push(new Float32Array([1, 2, 3]))

    const out = new Float32Array(5)
    out.fill(-1) // Fill with sentinel
    const pulled = rb.pull(out)

    expect(pulled).toBe(3)
    // First 3 modified
    expect(Array.from(out.slice(0, 3))).toEqual([1, 2, 3])
    // Last 2 untouched
    expect(Array.from(out.slice(3))).toEqual([-1, -1])
  })

  it('clears buffer on demand', () => {
    const rb = new RingBuffer(10)
    rb.push(new Float32Array([1, 2, 3]))
    rb.clear()
    
    expect(rb.availableFrames()).toBe(0)
    expect(rb.availableSpaces()).toBe(10)
  })
})
