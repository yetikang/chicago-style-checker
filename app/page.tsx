'use client'

import { useState, useMemo, useRef } from 'react'
import { RewriteResponse, Change } from '@/types'
import { X, Eye, Copy } from 'lucide-react'

// Normalize string for matching (handles whitespace, quotes, etc.)
function normalizeForMatching(str: string): string {
  return str
    .replace(/\s+/g, ' ') // Normalize all whitespace to single space
    .replace(/[""]/g, '"') // Normalize smart quotes to straight quotes
    .replace(/['']/g, "'") // Normalize smart apostrophes
    .replace(/[–—]/g, '-') // Normalize en/em dashes to hyphen
    .trim()
}

// Helper function to render revised text with highlights
function renderRevisedText(
  text: string,
  changes: Change[],
  showHighlights: boolean,
  activeChangeId: string | null,
  locatedChangeIds: Set<string>
): React.ReactNode[] {
  if (!showHighlights || changes.length === 0) {
    return [text]
  }

  // Find positions of each change in the text
  const changePositions: Array<{ start: number; end: number; change: Change }> = []

  // Debug logging (only in development - check if we're in dev mode)
  const isDev = typeof window !== 'undefined' && window.location.hostname === 'localhost'

  if (isDev) {
    console.log(`[Highlight] Processing ${changes.length} changes in text of length ${text.length}`)
  }

  changes.forEach(change => {
    // Prefer server-side offsets if available
    if (change.loc) {
      const { start, end } = change.loc
      if (start >= 0 && end <= text.length && start < end) {
        changePositions.push({
          start,
          end,
          change
        })
        locatedChangeIds.add(change.change_id)
        if (isDev) {
          console.log(`[Highlight] Using server offset for ${change.change_id}: ${start}-${end}`)
        }
        return // Skip to next change
      }
    }

    // Fallback to string matching if no server-side offset
    const searchText = change.after.trim()
    const normalizedSearchText = normalizeForMatching(searchText)

    // Build full context pattern: context_before + after + context_after
    const contextBefore = change.context_before.trim()
    const contextAfter = change.context_after.trim()
    const fullPattern = (contextBefore + ' ' + searchText + ' ' + contextAfter).trim()
    const normalizedPattern = normalizeForMatching(fullPattern)

    // Try to find the change using full context pattern first (most reliable)
    let found = false
    let matchIndex = -1
    let matchLength = searchText.length

    // Strategy 1: Try to find the full context pattern
    if (fullPattern.length > searchText.length && text.includes(fullPattern)) {
      const patternIndex = text.indexOf(fullPattern)
      if (patternIndex !== -1) {
        // Extract the position of "after" within the pattern
        const beforeInPattern = contextBefore.length
        matchIndex = patternIndex + beforeInPattern
        matchLength = searchText.length
        found = true
      }
    }

    // Strategy 2: Search for "after" text, then validate with normalized context
    if (!found) {
      const normalizedContextBefore = normalizeForMatching(contextBefore)
      const normalizedContextAfter = normalizeForMatching(contextAfter)

      // Try multiple search approaches
      const searchVariants = [
        searchText, // Original
        normalizedSearchText, // Normalized
        searchText.toLowerCase(), // Lowercase
      ]

      for (const searchVariant of searchVariants) {
        let searchStart = 0
        while (searchStart < text.length) {
          const index = text.toLowerCase().indexOf(searchVariant.toLowerCase(), searchStart)
          if (index === -1) break

          // Get surrounding context
          const beforeText = text.substring(Math.max(0, index - Math.max(contextBefore.length, 40)), index)
          const afterText = text.substring(index + searchVariant.length, index + searchVariant.length + Math.max(contextAfter.length, 40))

          // Normalize and compare
          const normalizedBefore = normalizeForMatching(beforeText)
          const normalizedAfter = normalizeForMatching(afterText)

          const contextBeforeMatch = contextBefore.length === 0 ||
            normalizedBefore.endsWith(normalizedContextBefore.slice(-Math.min(normalizedContextBefore.length, 25)))
          const contextAfterMatch = contextAfter.length === 0 ||
            normalizedAfter.startsWith(normalizedContextAfter.slice(0, Math.min(normalizedContextAfter.length, 25)))

          if (contextBeforeMatch && contextAfterMatch) {
            matchIndex = index
            matchLength = searchText.length // Use original length
            found = true
            break
          }

          searchStart = index + 1
        }
        if (found) break
      }
    }

    // Strategy 3: Fallback to simple search with normalized context validation
    if (!found) {
      let searchStart = 0
      while (searchStart < text.length) {
        const index = text.indexOf(searchText, searchStart)
        if (index === -1) break

        // Check context with normalization
        const beforeText = text.substring(Math.max(0, index - Math.max(contextBefore.length, 30)), index)
        const afterText = text.substring(index + searchText.length, index + searchText.length + Math.max(contextAfter.length, 30))

        const normalizedBefore = normalizeForMatching(beforeText)
        const normalizedAfter = normalizeForMatching(afterText)
        const normalizedContextBefore = normalizeForMatching(contextBefore)
        const normalizedContextAfter = normalizeForMatching(contextAfter)

        // Match if normalized context is close enough
        const contextBeforeMatch = contextBefore.length === 0 ||
          normalizedBefore.endsWith(normalizedContextBefore.slice(-Math.min(normalizedContextBefore.length, 20)))
        const contextAfterMatch = contextAfter.length === 0 ||
          normalizedAfter.startsWith(normalizedContextAfter.slice(0, Math.min(normalizedContextAfter.length, 20)))

        if (contextBeforeMatch && contextAfterMatch) {
          matchIndex = index
          matchLength = searchText.length
          found = true
          break
        }

        searchStart = index + 1
      }
    }

    if (found && matchIndex !== -1) {
      changePositions.push({
        start: matchIndex,
        end: matchIndex + matchLength,
        change
      })
      locatedChangeIds.add(change.change_id)

      if (isDev) {
        console.log(`[Highlight] Found change ${change.change_id} at index ${matchIndex}: "${text.substring(matchIndex, matchIndex + matchLength)}"`)
      }
    } else {
      if (isDev) {
        console.warn(`[Highlight] Could not locate change ${change.change_id}: after="${searchText}", context_before="${contextBefore}", context_after="${contextAfter}"`)
      }
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

    // Add strikethrough for the original text
    nodes.push(
      <span
        key={`${change.change_id}-diff-${start}`}
        className="line-through text-red-300 opacity-70 mr-1 select-none"
        aria-hidden="true"
      >
        {change.before}
      </span>
    )

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
  const [isQueued, setIsQueued] = useState(false)
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RewriteResponse | null>(null)
  const [activeChangeId, setActiveChangeId] = useState<string | null>(null)
  const [showHighlights, setShowHighlights] = useState(true)

  // Keep track of the latest input text to use when excessive debouncing fires
  const latestInputTextRef = useRef(inputText)
  // Update ref whenever text changes
  if (latestInputTextRef.current !== inputText) {
    latestInputTextRef.current = inputText
  }

  const abortControllerRef = useRef<AbortController | null>(null)

  const performRewrite = async () => {
    // Prevent multiple in-flight requests (double-check)
    if (loading) return

    const textToSend = latestInputTextRef.current
    if (!textToSend.trim()) {
      setError('Please enter some text to edit.')
      setIsQueued(false)
      return
    }

    // Cancel any previous request logic
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    setLoading(true)
    setIsQueued(false) // No longer queued, now processing
    setError(null)
    setResult(null)
    setActiveChangeId(null)

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // Client-side timeout (30 seconds)
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, 30000)

    try {
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: textToSend }),
        signal: abortController.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        // Try to parse error response
        let errorMessage = 'An error occurred while processing your text.'
        let errorType = 'unknown'
        try {
          const errorData = await response.json()
          if (errorData.error?.message) {
            errorMessage = errorData.error.message
          }
          if (errorData.error?.type) {
            errorType = errorData.error.type
          }
        } catch {
          // If JSON parsing fails, use status text
          errorMessage = `Error: ${response.status} ${response.statusText}`
        }

        // Handle 429 rate limit with friendly message
        if (response.status === 429 || errorType === 'rate_limit') {
          errorMessage = 'Rate limit exceeded. Please wait ~60 seconds and try again.'
        }

        throw new Error(errorMessage)
      }

      const data: RewriteResponse = await response.json()
      setResult(data)
    } catch (err) {
      // Handle timeout/abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Timed out after 30 seconds. Please try again or enable mock mode.')
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred while processing your text.')
      }
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleApply = () => {
    // If we're already loading, do nothing (or queue?)
    // Simplest: ignore clicks while actually processing
    if (loading) return

    // Clear existing debounce timer
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    setIsQueued(true)
    setError(null) // Clear previous errors when queuing

    // Schedule new request
    debounceTimeoutRef.current = setTimeout(() => {
      performRewrite()
    }, 1200)
  }

  // Clean up timeout on unmount
  useMemo(() => {
    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
    }
  }, [])

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
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
    setIsQueued(false)
  }

  // Compute located change IDs separately
  const locatedChangeIdsMemo = useMemo(() => {
    if (!result) return new Set<string>()
    const locatedIds = new Set<string>()
    renderRevisedText(
      result.revised_text,
      result.changes,
      true, // Always compute locations
      null, // No active change needed for computation
      locatedIds
    )
    return locatedIds
  }, [result])

  const renderedText = useMemo(() => {
    if (!result) return null
    const locatedIds = new Set(locatedChangeIdsMemo)
    return renderRevisedText(
      result.revised_text,
      result.changes,
      showHighlights,
      activeChangeId,
      locatedIds
    )
  }, [result, showHighlights, activeChangeId, locatedChangeIdsMemo])

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

        {/* Loading/Queued state */}
        {(loading || isQueued) && (
          <div className="mb-6 p-4 bg-gray-50 border border-gray-200 text-gray-700 rounded-sm transition-all duration-300">
            {isQueued
              ? 'Queued... (Waiting for typing to stop)'
              : 'Processing your text...'}
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
              className={`w-full px-6 py-3 rounded text-white font-normal text-base transition-colors ${loading
                ? 'bg-gray-400 cursor-not-allowed'
                : isQueued
                  ? 'bg-brand-red opacity-80'
                  : 'bg-brand-red hover:bg-brand-red-dark'
                }`}
            >
              {loading ? 'Processing...' : isQueued ? 'Queued...' : 'Apply Chicago Style'}
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
        {/* Changes list */}
        {result && (
          <div className="mt-10">
            <h2 className="text-lg font-serif font-normal mb-4 text-gray-900">
              Changes
            </h2>
            {result.changes.length > 0 ? (
              <ul className="space-y-2.5">
                {result.changes.map((change) => {
                  const isLocated = locatedChangeIdsMemo.has(change.change_id)
                  return (
                    <li
                      key={change.change_id}
                      onMouseEnter={() => {
                        if (isLocated) {
                          setActiveChangeId(change.change_id)
                        }
                      }}
                      onMouseLeave={() => {
                        if (isLocated) {
                          setActiveChangeId(null)
                        }
                      }}
                      className={`p-3 border-l border-gray-200 transition-colors ${isLocated
                        ? 'hover:border-gray-400 hover:bg-gray-50 cursor-pointer'
                        : 'opacity-60 cursor-default'
                        } ${activeChangeId === change.change_id ? 'border-gray-400 bg-gray-50' : ''
                        }`}
                      title={!isLocated ? 'Could not locate this change in the revised text' : undefined}
                    >
                      <div className="text-sm text-gray-900">
                        <span className="font-normal">
                          [{change.type}] {change.before} → {change.after}
                        </span>
                        {!isLocated && (
                          <span className="ml-2 text-xs text-gray-500 italic">(unlocated)</span>
                        )}
                        <span className="ml-2 text-gray-600">{change.reason}</span>
                        {change.severity !== 'required' && (
                          <span className="ml-2 text-xs text-gray-500">({change.severity})</span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-sm text-green-900">
                <div className="flex-shrink-0">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="font-serif text-sm">
                  Your text is correct according to Chicago Style.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

