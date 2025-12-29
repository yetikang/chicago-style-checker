'use client'

import { useState, useMemo } from 'react'
import { RewriteResponse, Change } from '@/types'
import { X, Eye, Copy } from 'lucide-react'

// Mock response function - simulates API call
async function mockRewrite(text: string): Promise<RewriteResponse> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Mock response with at least 2 spelling fixes and 1 punctuation fix
  // The revised_text contains the corrected versions
  return {
    revised_text: "The research methodology was comprehensive, including both quantitative and qualitative approaches. The study's findings revealed significant correlations between variables; however, the authors noted several limitations that warrant further investigation.",
    changes: [
      {
        change_id: "c1",
        type: "spelling",
        before: "quantative",
        after: "quantitative",
        reason: "Corrected spelling: 'quantative' should be 'quantitative' (Merriam-Webster standard)",
        severity: "required",
        context_before: "both ",
        context_after: " and qualitative"
      },
      {
        change_id: "c2",
        type: "spelling",
        before: "methodolgy",
        after: "methodology",
        reason: "Corrected spelling: 'methodolgy' should be 'methodology'",
        severity: "required",
        context_before: "research ",
        context_after: " was comprehensive"
      },
      {
        change_id: "c3",
        type: "punctuation",
        before: "variables",
        after: "variables;",
        reason: "Added semicolon before 'however' to properly connect independent clauses per Chicago style",
        severity: "required",
        context_before: "between ",
        context_after: " however, the"
      }
    ]
  }
}

// Helper function to render revised text with highlights
function renderRevisedText(
  text: string,
  changes: Change[],
  showHighlights: boolean,
  activeChangeId: string | null
): React.ReactNode[] {
  if (!showHighlights || changes.length === 0) {
    return [text]
  }

  // Find positions of each change in the text using context
  const changePositions: Array<{ start: number; end: number; change: Change }> = []
  
  changes.forEach(change => {
    const searchText = change.after
    const fullContextBefore = change.context_before + searchText
    const fullContextAfter = searchText + change.context_after
    
    // Try to find the change using context
    let found = false
    let searchStart = 0
    
    while (!found && searchStart < text.length) {
      const index = text.indexOf(searchText, searchStart)
      if (index === -1) break
      
      // Check if context matches (be flexible with context matching)
      const beforeText = text.substring(Math.max(0, index - change.context_before.length), index)
      const afterText = text.substring(index + searchText.length, index + searchText.length + change.context_after.length)
      
      // Match if context is close enough (allowing for some flexibility)
      const contextBeforeMatch = change.context_before.length === 0 || 
        beforeText.endsWith(change.context_before.slice(-Math.min(change.context_before.length, 15)))
      const contextAfterMatch = change.context_after.length === 0 || 
        afterText.startsWith(change.context_after.slice(0, Math.min(change.context_after.length, 15)))
      
      if (contextBeforeMatch && contextAfterMatch) {
        changePositions.push({
          start: index,
          end: index + searchText.length,
          change
        })
        found = true
      }
      
      searchStart = index + 1
    }
  })

  // Sort by position
  changePositions.sort((a, b) => a.start - b.start)

  // Remove overlapping changes (keep first one)
  const nonOverlapping: Array<{ start: number; end: number; change: Change }> = []
  let lastEnd = 0
  
  changePositions.forEach(pos => {
    if (pos.start >= lastEnd) {
      nonOverlapping.push(pos)
      lastEnd = pos.end
    }
  })

  if (nonOverlapping.length === 0) {
    return [text]
  }

  // Build React nodes
  const nodes: React.ReactNode[] = []
  let lastIndex = 0

  nonOverlapping.forEach(({ start, end, change }) => {
    // Add text before this change
    if (start > lastIndex) {
      nodes.push(text.substring(lastIndex, start))
    }

    // Add the changed text with highlight
    const isActive = activeChangeId === change.change_id
    nodes.push(
      <span
        key={`${change.change_id}-${start}`}
        data-change-id={change.change_id}
        className={`text-red-600 ${isActive ? 'bg-yellow-200 underline' : ''}`}
      >
        {text.substring(start, end)}
      </span>
    )

    lastIndex = end
  })

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push(text.substring(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}

export default function Home() {
  const [inputText, setInputText] = useState('')
  const [result, setResult] = useState<RewriteResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHighlights, setShowHighlights] = useState(true)
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null)

  const handleApply = async () => {
    if (!inputText.trim()) {
      setError('Please enter some text to edit.')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setActiveChangeId(null)

    try {
      const response = await mockRewrite(inputText)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while processing your text.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (result?.revised_text) {
      navigator.clipboard.writeText(result.revised_text)
    }
  }

  const handleClear = () => {
    setInputText('')
    setResult(null)
    setError(null)
    setActiveChangeId(null)
  }

  const renderedText = useMemo(() => {
    if (!result) return null
    return renderRevisedText(
      result.revised_text,
      result.changes,
      showHighlights,
      activeChangeId
    )
  }, [result, showHighlights, activeChangeId])

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Branded header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {/* Logo icon - simple book/academic icon */}
            <svg
              className="w-8 h-8 text-brand-red"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <h1 className="text-3xl font-serif font-normal text-gray-900">
              Chicago Style Checker
            </h1>
          </div>
          <div className="text-sm text-gray-600 font-serif">
            CMoS 17th Edition
          </div>
        </div>

        {/* Subtle divider */}
        <div className="border-b border-gray-200 mb-8"></div>

        {/* Error state */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded-sm">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="mb-6 p-4 bg-gray-50 border border-gray-200 text-gray-700 rounded-sm">
            Processing your text...
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Left: Input textarea */}
          <div className="flex flex-col min-h-[26rem]">
            {/* Left panel header */}
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm font-normal text-gray-700">
                Original Paragraph
              </label>
              <button
                onClick={handleClear}
                aria-label="Clear input text"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
                Clear
              </button>
            </div>
            
            {/* Textarea */}
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste a paragraph to edit…"
              className="w-full flex-1 min-h-[18rem] p-5 border border-gray-200 rounded font-serif text-gray-900 leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-300 mb-4 text-base"
            />
            
            {/* Apply Chicago Style button */}
            <button
              onClick={handleApply}
              disabled={loading}
              className="w-full px-6 py-3 bg-brand-red text-white rounded hover:bg-brand-red-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-normal text-base"
            >
              {loading ? 'Processing...' : 'Apply Chicago Style'}
            </button>
          </div>

          {/* Right: Revised output */}
          <div className="flex flex-col min-h-[26rem]">
            {/* Right panel header */}
            <div className="flex justify-between items-center mb-3">
              <label className="text-sm font-normal text-gray-700">
                Revised Paragraph
              </label>
              <div className="flex items-center gap-3">
                {/* Toggle switch for highlights */}
                {result && (
                  <>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Eye className="w-4 h-4 text-gray-700" strokeWidth={1.5} />
                      <span className="text-sm text-gray-700">Show highlights</span>
                      <div className="relative inline-block w-11 h-6">
                        <input
                          type="checkbox"
                          checked={showHighlights}
                          onChange={(e) => setShowHighlights(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="absolute top-0 left-0 w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-brand-red transition-colors duration-200"></div>
                        <div className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full transition-transform duration-200 ${showHighlights ? 'translate-x-5' : 'translate-x-0'}`}></div>
                      </div>
                    </label>
                    <button
                      onClick={handleCopy}
                      aria-label="Copy revised text to clipboard"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1"
                    >
                      <Copy className="w-4 h-4" strokeWidth={1.5} />
                      Copy revised text
                    </button>
                  </>
                )}
              </div>
            </div>
            
            {/* Revised text display */}
            <div className="w-full flex-1 min-h-[18rem] p-5 border border-gray-200 rounded font-serif text-gray-900 leading-relaxed bg-white overflow-y-auto text-base">
              {result ? (
                <div>{renderedText}</div>
              ) : (
                <div className="text-gray-400 italic text-sm">
                  Revised text will appear here after processing...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Changes list */}
        {result && result.changes.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-serif font-normal mb-4 text-gray-900">
              Changes
            </h2>
            <ul className="space-y-2.5">
              {result.changes.map((change) => (
                <li
                  key={change.change_id}
                  onMouseEnter={() => setActiveChangeId(change.change_id)}
                  onMouseLeave={() => setActiveChangeId(null)}
                  className={`p-3 border-l border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-colors cursor-pointer ${
                    activeChangeId === change.change_id ? 'border-gray-400 bg-gray-50' : ''
                  }`}
                >
                  <div className="text-sm text-gray-900">
                    <span className="font-normal">
                      [{change.type}] {change.before} → {change.after}
                    </span>
                    <span className="ml-2 text-gray-600">{change.reason}</span>
                    {change.severity !== 'required' && (
                      <span className="ml-2 text-xs text-gray-500">({change.severity})</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

