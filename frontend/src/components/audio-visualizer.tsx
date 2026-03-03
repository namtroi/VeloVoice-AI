/**
 * audio-visualizer.tsx
 *
 * Dynamic animated CSS visualizer representing the voice assistant's state.
 */

import { useMemo } from 'react'
import type { SessionStatus } from '../stores/session-store'

interface AudioVisualizerProps {
  status: SessionStatus
}

export function AudioVisualizer({ status }: AudioVisualizerProps) {
  // We use CSS animations to simulate an audio wave, simplifying Phase 6.
  // Real AnalyserNode logic can be plugged here in the future if needed.
  
  const isSpeaking = status === 'speaking'
  const isListening = status === 'listening'
  const isActive = isSpeaking || isListening
  
  // Memoize the random animation values so they don't change on every render
  const bars = useMemo(() => {
    return Array.from({ length: 15 }).map((_, i) => {
      // Center bars are naturally taller
      const distanceToCenter = Math.abs(i - 7)
      const baseHeight = Math.max(10, 80 - distanceToCenter * 10)
      
      const animationDelay = `${i * 0.05}s`
      
      // Use deterministic pseudo-random variation based on index instead of Math.random
      // e.g. sinusoidal variation
      const pseudoRandom = (Math.sin(i * 4.5) + 1) / 2 // maps to 0..1
      const animationDuration = `${0.6 + pseudoRandom * 0.4}s`
      
      return { id: i, baseHeight, animationDelay, animationDuration }
    })
  }, [])

  return (
    <div className="flex items-center justify-center h-32 w-full bg-gray-800/30 rounded-3xl border border-gray-700/50 shadow-inner overflow-hidden">
      <div className="flex items-center gap-1 sm:gap-1.5 h-full py-4">
        {bars.map((bar) => {
          // Flatten the wave if inactive
          const height = isActive ? `${bar.baseHeight}%` : '8%'
          
          // Color changes based on who is talking
          let bgColor = 'bg-gray-600'
          if (isSpeaking) bgColor = 'bg-purple-500' // output
          else if (isListening) bgColor = 'bg-blue-500' // input

          return (
            <div
              key={bar.id}
              className={`w-1.5 sm:w-2 rounded-full transition-all duration-300 ease-in-out ${bgColor} ${isActive ? 'animate-wave' : ''}`}
              style={{
                height,
                animationDelay: bar.animationDelay,
                animationDuration: bar.animationDuration,
                // Only animate if active
                animationPlayState: isActive ? 'running' : 'paused',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
