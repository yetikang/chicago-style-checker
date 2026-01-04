'use client'

import { useState, useMemo, useRef } from 'react'
import { RewriteResponse, Change } from '@/types'
import { X, Eye, Copy } from 'lucide-react'
import Link from 'next/link'

// Helper function to render revised text with highlights strictly from server-provided authoritative data
function renderRevisedText(
    revisedText: string,
    changes: Change[],
    showHighlights: boolean,
    activeChangeId: string | null
): React.ReactNode[] {
    if (!showHighlights || changes.length === 0) {
        return [revisedText]
    }

    // Collect all located changes (those with loc field)
    const locatedChanges = changes.filter(c => c.loc)

    // Sort by location
    locatedChanges.sort((a, b) => (a.loc!.start) - (b.loc!.start))

    const nodes: React.ReactNode[] = []
    let lastIndex = 0

    locatedChanges.forEach((change, idx) => {
        const { start, end } = change.loc!

        // Skip if this highlight overlaps with previous
        if (start < lastIndex) return

        // Add plain text before this highlight
        if (start > lastIndex) {
            nodes.push(revisedText.substring(lastIndex, start))
        }

        const isActive = activeChangeId === change.change_id

        // Show both deleted text (strikethrough) and inserted text
        if (change.before && change.before !== change.after) {
            nodes.push(
                <span
                    key={`${change.change_id}-before-${start}`}
                    className="line-through text-red-300 opacity-70 mr-1 select-none"
                    aria-hidden="true"
                >
                    {change.before}
                </span>
            )
        }

        // Show inserted/replaced text
        nodes.push(
            <span
                key={`${change.change_id}-after-${start}`}
                data-change-id={change.change_id}
                className={`text-red-600 transition-all ${isActive ? 'underline font-semibold' : ''}`}
            >
                {revisedText.substring(start, end)}
            </span>
        )

        lastIndex = end
    })

    if (lastIndex < revisedText.length) {
        nodes.push(revisedText.substring(lastIndex))
    }

    return nodes.length > 0 ? nodes : [revisedText]
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

    const latestInputTextRef = useRef(inputText)
    if (latestInputTextRef.current !== inputText) {
        latestInputTextRef.current = inputText
    }

    const abortControllerRef = useRef<AbortController | null>(null)

    const performRewrite = async () => {
        if (loading) return

        const textToSend = latestInputTextRef.current
        if (!textToSend.trim()) {
            setError('Please enter some text to edit.')
            setIsQueued(false)
            return
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }

        setLoading(true)
        setIsQueued(false)
        setError(null)
        setResult(null)
        setActiveChangeId(null)

        const abortController = new AbortController()
        abortControllerRef.current = abortController

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
                let errorMessage = 'An error occurred while processing your text.'
                let errorType = 'unknown'
                let errorData: any = null

                try {
                    errorData = await response.json()
                    if (errorData.error?.message) {
                        errorMessage = errorData.error.message
                    }
                    if (errorData.error?.type) {
                        errorType = errorData.error.type
                    }
                } catch {
                    errorMessage = `Error: ${response.status} ${response.statusText}`
                }

                if (response.status === 429 || errorType === 'rate_limit') {
                    const scope = errorData?.scope
                    const seconds = errorData?.retry_after_seconds || 60
                    if (scope === 'user_day') {
                        const hours = Math.ceil(seconds / 3600)
                        errorMessage = `Daily limit reached. Please try again in about ${hours} ${hours === 1 ? 'hour' : 'hours'}.`
                    } else if (scope === 'user_30s') {
                        errorMessage = `Slow down! Please wait ${seconds} seconds before your next request.`
                    } else {
                        errorMessage = 'Rate limit reached. Please wait a moment and try again.'
                    }
                }
                throw new Error(errorMessage)
            }

            const data: RewriteResponse = await response.json()
            setResult(data)
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                setError('Timed out after 30 seconds.')
            } else {
                setError(err instanceof Error ? err.message : 'An error occurred.')
            }
        } finally {
            clearTimeout(timeoutId)
            setLoading(false)
            abortControllerRef.current = null
        }
    }

    const handleApply = () => {
        if (loading) return
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current)
        }
        setIsQueued(true)
        setError(null)
        debounceTimeoutRef.current = setTimeout(() => {
            performRewrite()
        }, 1200)
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
        if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
        setIsQueued(false)
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
        <div className="min-h-screen bg-white p-8 font-sans">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <svg className="w-8 h-8 text-brand-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <h1 className="text-3xl font-serif font-normal text-gray-900">
                            Chicago Style Checker <span className="text-base text-gray-500 font-sans">(Beta)</span>
                        </h1>
                    </div>
                </div>

                <div className="border-b border-gray-200 mb-8"></div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded-sm">
                        {error}
                    </div>
                )}

                {(loading || isQueued) && (
                    <div className="mb-6 p-4 bg-gray-50 border border-gray-200 text-gray-700 rounded-sm">
                        {isQueued ? 'Queued... (Waiting for typing to stop)' : 'Processing your text...'}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    <div className="flex flex-col min-h-[26rem]">
                        <div className="flex justify-between items-center mb-3">
                            <label className="text-sm font-normal text-gray-700">Original Paragraph</label>
                            <button onClick={handleClear} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded transition-colors">
                                <X className="w-4 h-4" /> Clear
                            </button>
                        </div>
                        <textarea
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder="Paste a paragraph to edit…"
                            className="w-full flex-1 min-h-[18rem] p-5 border border-gray-200 rounded font-serif text-gray-900 leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-gray-400 mb-4 text-base"
                        />
                        <button
                            onClick={handleApply}
                            disabled={loading}
                            className={`w-full px-6 py-3 rounded text-white font-normal text-base transition-colors ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-red hover:bg-brand-red-dark'}`}
                        >
                            {loading ? 'Processing...' : 'Apply Chicago Style'}
                        </button>
                    </div>

                    <div className="flex flex-col min-h-[26rem]">
                        <div className="flex justify-between items-center mb-3">
                            <label className="text-sm font-normal text-gray-700">Revised Paragraph</label>
                            {result && (
                                <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <Eye className="w-4 h-4 text-gray-700" />
                                        <span className="text-sm text-gray-700">Show highlights</span>
                                        <input type="checkbox" checked={showHighlights} onChange={(e) => setShowHighlights(e.target.checked)} className="sr-only peer" />
                                        <div className="relative w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-brand-red transition-colors duration-200">
                                            <div className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full transition-transform duration-200 ${showHighlights ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                        </div>
                                    </label>
                                    <button onClick={handleCopy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded transition-colors">
                                        <Copy className="w-4 h-4" /> Copy
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="w-full flex-1 min-h-[18rem] p-5 border border-gray-200 rounded font-serif text-gray-900 leading-relaxed bg-white overflow-y-auto text-base">
                            {result ? <div>{renderedText}</div> : <div className="text-gray-400 italic text-sm">Revised text will appear here...</div>}
                        </div>
                    </div>
                </div>

                {result && (
                    <div className="mt-10">
                        <h2 className="text-lg font-serif font-normal mb-4 text-gray-900">Changes</h2>
                        {result.changes.length > 0 ? (
                            <ul className="space-y-2.5">
                                {result.changes.map((change) => {
                                    const hasLoc = Boolean(change.loc)
                                    return (
                                        <li
                                            key={change.change_id}
                                            onMouseEnter={() => hasLoc && setActiveChangeId(change.change_id)}
                                            onMouseLeave={() => hasLoc && setActiveChangeId(null)}
                                            className={`p-3 border-l border-gray-200 transition-all ${hasLoc ? 'hover:border-gray-400 hover:bg-gray-50 cursor-pointer' : 'opacity-60'} ${activeChangeId === change.change_id ? 'border-gray-400 bg-gray-50' : ''}`}
                                        >
                                            <div className="flex flex-col gap-1">
                                                <div className="text-sm text-gray-900 flex flex-wrap items-center gap-2">
                                                    <span className="font-serif font-medium text-gray-900">[{change.type}]</span>
                                                    <span className="font-serif text-gray-600 line-through decoration-red-300 decoration-1">{change.before}</span>
                                                    <span className="text-gray-400">→</span>
                                                    <span className="font-serif font-medium text-brand-red">{change.after}</span>
                                                    {!hasLoc && <span className="text-xs text-gray-500 italic px-1.5 py-0.5 bg-gray-100 rounded">(unlocated)</span>}
                                                </div>
                                                <div className="text-sm text-gray-600 leading-snug">
                                                    {change.reason}
                                                    {change.severity !== 'recommended' && (
                                                        <span className="ml-2 text-xs text-gray-400 italic">({change.severity})</span>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        ) : (
                            <div className="p-4 bg-green-50 border border-green-200 rounded-sm text-green-900 font-serif text-sm">
                                Your text is correct according to Chicago Style.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
