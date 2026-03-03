/**
 * transcript-panel.tsx
 *
 * Displays the chat-like history of interactions. Auto-scrolls on new messages.
 */

import { useEffect, useRef } from 'react'
import type { Message, SessionStatus } from '../stores/session-store'

interface TranscriptPanelProps {
  transcript: Message[]
  status: SessionStatus
}

export function TranscriptPanel({ transcript, status }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when transcript or status changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [transcript, status])

  const showProcessing = status === 'processing'
  const showListening = status === 'listening'

  return (
    <div className="flex flex-col h-full bg-gray-800/50 rounded-3xl border border-gray-700/50 overflow-hidden shadow-inner">
      <div className="p-4 border-b border-gray-700/50 bg-gray-800/80 backdrop-blur-sm shadow-sm z-10">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <span className="text-gray-400">💬</span> Conversation History
        </h3>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scroll-smooth scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent"
      >
        {transcript.length === 0 && !showProcessing && !showListening && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3 opacity-70">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-sm font-medium">Your conversation will appear here</p>
          </div>
        )}

        {transcript.map((msg, i) => (
          <div
            key={i}
            className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
          >
            <div
              className={`
                max-w-[85%] sm:max-w-[75%] rounded-2xl px-5 py-3.5 shadow-sm
                ${msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-br-sm' 
                  : 'bg-gray-700 text-gray-100 rounded-bl-sm border border-gray-600'
                }
              `}
            >
              <span className={`text-[0.65rem] font-bold uppercase tracking-wider mb-1 block opacity-70 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                {msg.role === 'user' ? 'You' : 'Assistant'}
              </span>
              <p className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap">{msg.text}</p>
            </div>
          </div>
        ))}

        {/* Processing Indicator */}
        {showProcessing && (
          <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-gray-700 text-gray-400 rounded-2xl rounded-bl-sm border border-gray-600 px-5 py-4 shadow-sm">
              <div className="flex items-center gap-1.5 h-6">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Listening Indicator */}
        {showListening && (
          <div className="flex w-full justify-end animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 text-blue-400 px-2 py-1">
              <span className="text-xs font-medium uppercase tracking-widest">Listening</span>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
