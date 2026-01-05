'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { RewriteResponse, Change, HistoryItem } from '@/types'
import { X, Eye, Copy, History, Trash2, Clock } from 'lucide-react'
import Link from 'next/link'
import { useSession } from '@/lib/session-store'

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
    const { session, pushHistory, clearSession, touch, isLoading } = useSession()
    const [isQueued, setIsQueued] = useState(false)
    const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const [inputText, setInputText] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<RewriteResponse | null>(null)
    const [activeChangeId, setActiveChangeId] = useState<string | null>(null)
    const [showHighlights, setShowHighlights] = useState(true)

    // Draft persistence
    useEffect(() => {
        const savedDraft = sessionStorage.getItem('cmos:draft:v1')
        if (savedDraft && !inputText) {
            setInputText(savedDraft)
        }
    }, [])

    useEffect(() => {
        if (inputText) {
            sessionStorage.setItem('cmos:draft:v1', inputText)
            touch()
        } else {
            sessionStorage.removeItem('cmos:draft:v1')
        }
    }, [inputText, touch])

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
            pushHistory(textToSend, data, response.headers.get('X-Provider') || undefined)
            return
        } catch (err: any) {
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
        sessionStorage.removeItem('cmos:draft:v1')
        if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current)
        setIsQueued(false)
    }

    const handleClearSession = () => {
        if (confirm('Are you sure you want to clear your entire session history and draft?')) {
            clearSession()
            setResult(null)
            setInputText('')
        }
    }

    const handleSelectHistory = (item: HistoryItem) => {
        setInputText(item.input)
        setResult(item.output)
        touch()
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
        <div className="min-h-screen bg-[#fcfbf7] p-8 font-ui text-[#1a1a1a]">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <svg className="w-8 h-8 text-brand-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <h1 className="text-3xl font-academic font-normal tracking-tight text-gray-900">
                            Chicago Style Checker <span className="text-base text-gray-400 font-ui font-light">(Beta)</span>
                        </h1>
                    </div>
                    <div className="flex items-center gap-6">
                        <Link
                            href="/about"
                            className="text-xs tracking-widest text-gray-500 hover:text-brand-red transition-colors font-medium"
                        >
                            ABOUT
                        </Link>
                        <span className="text-gray-200">|</span>
                        <a
                            href="https://forms.gle/kt8CLYoZRsdESXyh7"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs tracking-widest text-gray-500 hover:text-brand-red transition-colors font-medium"
                        >
                            FEEDBACK
                        </a>
                        <span className="text-gray-200">|</span>
                        <a
                            href="https://www.chicagomanualofstyle.org/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs tracking-widest text-gray-500 hover:text-brand-red transition-colors font-medium"
                        >
                            CMoS ONLINE
                        </a>
                    </div>
                </div>

                <div className="border-b border-gray-100 mb-10"></div>

                {error && (
                    <div className="mb-8 p-4 bg-red-50/50 border border-red-100 text-red-800 rounded-sm font-ui text-sm">
                        {error}
                    </div>
                )}

                {(loading || isQueued) && (
                    <div className="mb-8 p-4 bg-gray-50/50 border border-gray-100 text-gray-600 rounded-sm font-ui text-sm flex items-center gap-3">
                        <div className="w-2 h-2 bg-brand-red rounded-full animate-pulse"></div>
                        {isQueued ? 'Queued... (Waiting for typing to stop)' : 'Processing your text...'}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-10">
                    <div className="flex flex-col min-h-[28rem]">
                        <div className="flex justify-between items-center mb-4">
                            <label className="text-xs uppercase tracking-widest font-semibold text-gray-500">Original Paragraph</label>
                            <button onClick={handleClear} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-all">
                                <X className="w-3.5 h-3.5" /> Clear
                            </button>
                        </div>
                        <textarea
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder="Paste your manuscript excerpt here…"
                            className="w-full flex-1 min-h-[20rem] p-6 border border-gray-200/60 rounded-sm font-academic text-gray-900 leading-relaxed resize-none focus:outline-none focus:border-brand-red/30 focus:ring-0 mb-6 text-lg transition-all placeholder:text-gray-300"
                        />
                        <button
                            onClick={handleApply}
                            disabled={loading}
                            className={`w-full px-8 py-4 rounded-sm text-white font-ui uppercase tracking-[0.2em] text-xs font-semibold shadow-sm transition-all ${loading ? 'bg-gray-300 cursor-not-allowed' : 'bg-brand-red hover:bg-brand-red-dark active:scale-[0.99]'}`}
                        >
                            {loading ? 'Analyzing...' : 'Apply Chicago Style'}
                        </button>
                    </div>

                    <div className="flex flex-col min-h-[28rem]">
                        <div className="flex justify-between items-center mb-4">
                            <label className="text-xs uppercase tracking-widest font-semibold text-gray-500">Revised Paragraph</label>
                            {result && (
                                <div className="flex items-center gap-6">
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <Eye className="w-4 h-4 text-gray-400 group-hover:text-brand-red transition-colors" />
                                        <span className="text-xs uppercase tracking-widest text-gray-500 font-medium">Show highlights</span>
                                        <input type="checkbox" checked={showHighlights} onChange={(e) => setShowHighlights(e.target.checked)} className="sr-only peer" />
                                        <div className="relative w-10 h-5 bg-gray-200 rounded-full peer-checked:bg-brand-red transition-colors duration-200">
                                            <div className={`absolute top-[2px] left-[2px] w-4 h-4 bg-white rounded-full transition-transform duration-200 ${showHighlights ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                        </div>
                                    </label>
                                    <button onClick={handleCopy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-widest text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-all">
                                        <Copy className="w-3.5 h-3.5" /> Copy
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="w-full flex-1 min-h-[20rem] p-6 border border-gray-200/60 rounded-sm font-academic text-gray-900 leading-relaxed bg-[#fefefe] shadow-inner-sm overflow-y-auto text-lg selection:bg-red-50">
                            {result ? <div>{renderedText}</div> : <div className="text-gray-300 italic text-sm font-ui">Analytical output will appear here...</div>}
                        </div>
                    </div>
                </div>

                {result && (
                    <div className="mt-12 mb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <h2 className="text-xl font-academic font-normal mb-6 text-gray-900 border-b border-gray-100 pb-2">Technical Revisions</h2>
                        {result.changes.length > 0 ? (
                            <ul className="space-y-4">
                                {result.changes.map((change) => {
                                    const hasLoc = Boolean(change.loc)
                                    return (
                                        <li
                                            key={change.change_id}
                                            onMouseEnter={() => hasLoc && setActiveChangeId(change.change_id)}
                                            onMouseLeave={() => hasLoc && setActiveChangeId(null)}
                                            className={`p-4 border-l-2 border-transparent transition-all hover:bg-white hover:shadow-sm ${hasLoc ? 'cursor-pointer' : 'opacity-60'} ${activeChangeId === change.change_id ? 'border-brand-red bg-white shadow-sm' : 'hover:border-gray-200'}`}
                                        >
                                            <div className="flex flex-col gap-2">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-sm">
                                                        {change.type === 'INSERT_AT_END' ? 'Punctuation' : change.type}
                                                    </span>
                                                    <div className="flex items-center gap-2 text-sm">
                                                        {change.type === 'INSERT_AT_END' ? (
                                                            <>
                                                                <span className="font-academic font-medium text-brand-red">+{change.after}</span>
                                                                <span className="text-gray-400 italic text-[11px] ml-1">at end of paragraph</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span className="font-academic text-gray-400 line-through decoration-red-200/50 decoration-1">{change.before}</span>
                                                                <span className="text-gray-300 font-light mx-1">→</span>
                                                                <span className="font-academic font-medium text-brand-red">{change.after}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                    {!hasLoc && <span className="text-[10px] uppercase tracking-wider text-gray-400 px-1.5 py-0.5 bg-gray-50 rounded-sm">unlocated</span>}
                                                </div>
                                                <div className="text-[13px] text-gray-600 leading-relaxed font-ui">
                                                    {change.reason}
                                                    {change.severity !== 'recommended' && (
                                                        <span className="ml-2 text-[11px] text-gray-400 italic">({change.severity})</span>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        ) : (
                            <div className="p-6 bg-green-50/30 border border-green-100/50 rounded-sm text-green-800 font-academic text-base italic">
                                The text conforms to Chicago Style conventions. No technical revisions identified.
                            </div>
                        )}
                    </div>
                )}

                {/* Session History Section */}
                {session && session.history.length > 0 && (
                    <div className="mt-20 pb-20 border-t border-gray-100 pt-12 animate-in fade-in duration-1000">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <History className="w-5 h-5 text-gray-400" />
                                <h2 className="text-lg font-academic font-normal text-gray-900">Recent History</h2>
                            </div>
                            <button
                                onClick={handleClearSession}
                                className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-400 hover:text-brand-red transition-colors font-bold"
                            >
                                <Trash2 className="w-3 h-3" />
                                Clear Session
                            </button>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            {session.history.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => handleSelectHistory(item)}
                                    className="text-left p-4 bg-white/50 border border-gray-100 rounded-sm hover:border-brand-red/30 hover:bg-white transition-all group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="flex flex-col gap-1 min-w-[80px]">
                                            <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-medium">
                                                <Clock className="w-3 h-3" />
                                                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                            {item.provider && (
                                                <span className="text-[9px] uppercase tracking-tighter text-gray-300 font-bold">{item.provider}</span>
                                            )}
                                        </div>
                                        <div className="flex-1 truncate text-sm font-ui text-gray-500 group-hover:text-gray-900 transition-colors">
                                            {item.input.slice(0, 100)}{item.input.length > 100 ? '...' : ''}
                                        </div>
                                        <div className="text-[10px] text-brand-red opacity-0 group-hover:opacity-100 transition-opacity font-bold uppercase tracking-widest">
                                            Restore →
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
