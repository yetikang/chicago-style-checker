import { NextRequest, NextResponse } from 'next/server'
import { RewriteResponse, Change } from '@/types'
import { getOrSetAnonId, setAnonIdCookie, consumeExpensiveCall } from '@/lib/ratelimit'
import OpenAI from 'openai'

// Dynamically require diff-match-patch to avoid build issues if types are weird
const DiffMatchPatch = require('diff-match-patch')

const MAX_TEXT_LENGTH = 4000

interface ErrorResponse {
    error: {
        type: string
        message: string
    }
}

// Helper to create error response
function errorResponse(
    status: number,
    type: string,
    message: string
): NextResponse<ErrorResponse> {
    return NextResponse.json(
        { error: { type, message } },
        {
            status,
            headers: {
                'Cache-Control': 'no-store',
            },
        }
    )
}

// Helper to create success response
function successResponse(
    data: RewriteResponse
): NextResponse<RewriteResponse> {
    return NextResponse.json(data, {
        headers: {
            'Cache-Control': 'no-store',
        },
    })
}

const PROMPT_VERSION = 'v1.1' // Increment when prompt changes
const DEBUG_LOC = process.env.DEBUG_LOC === '1'

// --- Cache & Dedupe (Server-Side In-Memory) ---
type CachedResponse = {
    data: RewriteResponse
    timestamp: number
}
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const cache = new Map<string, CachedResponse>()
const pendingRequests = new Map<string, Promise<RewriteResponse>>()

function generateCacheKey(text: string, mode: string, provider: string): string {
    // Normalize basics for cache key
    const normalized = text.trim().replace(/\r\n/g, '\n')
    // Simple hash for key
    let hash = 0
    for (let i = 0; i < normalized.length; i++) {
        const char = normalized.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash // Convert to 32bit integer
    }
    return `${hash}_${mode}_${provider}_${PROMPT_VERSION}`
}

// --- Robust Location Logic with Ambiguity Handling ---

// Normalize string for matching (handles whitespace, quotes, etc.)
function normalizeForMatching(str: string): string {
    return str
        .replace(/\s+/g, ' ') // Normalize all whitespace to single space
        .replace(/[""]/g, '"') // Normalize smart quotes to straight quotes
        .replace(/['']/g, "'") // Normalize smart apostrophes
        .replace(/[–—]/g, '-') // Normalize en/em dashes to hyphen
        .trim()
}

// Helpers for context matching scores
function normalizeForContext(str: string): string {
    // Aggressive normalization: remove ALL non-alphanumeric chars
    return str.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function getContextScore(text: string, anchorStr: string, isStart: boolean): number {
    if (!anchorStr) return 0.5 // Neutral score for empty context matches (technically a match)

    const normalizedAnchor = normalizeForContext(anchorStr)
        // take only last 25 chars for before-context, first 25 for after-context
        .slice(isStart ? -25 : 0, isStart ? undefined : 25)

    if (!normalizedAnchor) return 0.5 // If context was only punctuation, ignore it

    const normalizedText = normalizeForContext(text)

    if (isStart) {
        if (normalizedText.endsWith(normalizedAnchor)) return 1.0
    } else {
        if (normalizedText.startsWith(normalizedAnchor)) return 1.0
    }

    return 0.0
}

// Robustly locate a single change in the final text with ambiguity handling
function locateChangeInText(text: string, change: Change): { start: number; end: number } | null {
    const searchText = change.after.trim()
    if (!searchText) {
        return null
    }

    const normalizedSearchText = normalizeForMatching(searchText)
    const contextBefore = change.context_before.trim()
    const contextAfter = change.context_after.trim()

    // Find all candidate indices
    const candidates: { index: number; score: number; length: number }[] = []

    // 1. Exact string search
    let searchStart = 0
    while (searchStart < text.length) {
        const idx = text.indexOf(searchText, searchStart)
        if (idx === -1) break

        // Score this candidate
        // Extract context from text around this candidate
        const textBefore = text.substring(Math.max(0, idx - 40), idx)
        const textAfter = text.substring(idx + searchText.length, idx + searchText.length + 40)

        const scoreBefore = getContextScore(textBefore, contextBefore, true)
        const scoreAfter = getContextScore(textAfter, contextAfter, false)

        candidates.push({
            index: idx,
            score: scoreBefore + scoreAfter + 1.0, // +1 for exact text match
            length: searchText.length
        })

        searchStart = idx + 1
    }

    // 2. Normalized fallback search
    const idealMatch = candidates.find(c => c.score >= 3.0)
    if (idealMatch) {
        return { start: idealMatch.index, end: idealMatch.index + idealMatch.length }
    }

    // If no good exact matches, try normalized/fuzzy search
    const searchCandidates = [searchText, normalizedSearchText, searchText.toLowerCase()]
    const uniqueSearchStrings = Array.from(new Set(searchCandidates)).filter(s => s && s !== searchText)

    for (const variant of uniqueSearchStrings) {
        searchStart = 0
        while (searchStart < text.length) {
            const idx = text.toLowerCase().indexOf(variant.toLowerCase(), searchStart)
            if (idx === -1) break

            const matchLen = variant.length
            const textBefore = text.substring(Math.max(0, idx - 40), idx)
            const textAfter = text.substring(idx + matchLen, idx + matchLen + 40)

            const scoreBefore = getContextScore(textBefore, contextBefore, true)
            const scoreAfter = getContextScore(textAfter, contextAfter, false)

            candidates.push({
                index: idx,
                score: scoreBefore + scoreAfter + 0.8, // 0.8 for fuzzy match
                length: matchLen
            })
            searchStart = idx + 1
        }
    }

    if (candidates.length === 0) return null

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score)

    const best = candidates[0]

    // Safety threshold: if score is too low, we might be matching random common words
    if (best.score < 2.0) {
        if (DEBUG_LOC) console.log(`[Locate] Rejecting low confidence match for "${searchText}": score ${best.score}`)
        // Let's accept it but log it.
    }

    return { start: best.index, end: best.index + best.length }
}

function recalculateAllLocations(text: string, changes: Change[]): Change[] {
    const result = changes.map(change => {
        if (!change.after || !change.after.trim()) return change;

        const loc = locateChangeInText(text, change)
        if (loc) {
            return { ...change, loc }
        }

        const { loc: _, ...rest } = change
        return rest as Change
    })
    return result
}


// --- Diff Fallback Logic ---
function computeMissingChanges(originalText: string, revisedText: string, existingChanges: Change[]): Change[] {
    const dmp = new DiffMatchPatch()
    const diffs = dmp.diff_main(originalText, revisedText)
    dmp.diff_cleanupSemantic(diffs)

    const newChanges: Change[] = []
    let currentPos = 0 // Position in revisedText

    // We need to check if a diff is "covered" by an existing change
    // An existing change "covers" a range [start, end] in revisedText.

    // First, map existing changes to coverage intervals in revisedText
    const coverageIntervals: { start: number, end: number }[] = []
    existingChanges.forEach(c => {
        if (c.loc) {
            coverageIntervals.push({ start: c.loc.start, end: c.loc.end })
        }
    })

    // Simple interval check helper
    const isCovered = (start: number, end: number) => {
        // We consider it covered if it overlaps significantly with any existing change
        // Or even simpler: if the center point is inside a change? 
        // Let's go with: if ANY part of it overlaps, we assume the LLM intended it.
        // Actually, we want to catch *missed* things.
        // If the diff is "inserted text", check if that text range is inside a known change range.
        if (start >= end) return true // empty range
        return coverageIntervals.some(interval => {
            return (start < interval.end && end > interval.start)
        })
    }

    let autoCount = 1

    diffs.forEach(([operation, text]: [number, string]) => {
        if (operation === 0) { // EQUAL
            currentPos += text.length
        } else if (operation === 1) { // INSERT (Text in Revised but not Original)
            const start = currentPos
            const end = currentPos + text.length

            if (!isCovered(start, end)) {
                // Found an insertion not covered by LLM changes!
                // We need context to help locating (though we know the exact pos, the system needs context objects)
                const contextBefore = revisedText.substring(Math.max(0, start - 20), start)
                const contextAfter = revisedText.substring(end, Math.min(revisedText.length, end + 20))

                newChanges.push({
                    change_id: `auto_${Date.now()}_${autoCount++}`,
                    type: 'other',
                    before: '',
                    after: text,
                    reason: 'Auto-detected change',
                    severity: 'recommended',
                    context_before: contextBefore,
                    context_after: contextAfter,
                    loc: { start, end }
                })
            }
            currentPos += text.length
        } else if (operation === -1) { // DELETE (Text in Original but not Revised)
            // We process deletions but skip creating explicit changes for them
            // as they are hard to visualize in the current UI without 'after' content.
        }
    })

    return newChanges
}


// --- Cheap Rules Engine ---
function applyCheapRules(text: string): { revisedText: string; changes: Change[] } {
    let revised = text
    const changes: Change[] = []
    let ruleChangeCounter = 1

    // Helper to apply regex replacement and track changes
    function applyRegexRule(
        regex: RegExp,
        replacementFn: (match: RegExpExecArray) => string,
        type: Change['type'],
        reason: string
    ) {
        let match
        // Reset regex index
        regex.lastIndex = 0
        const matches: { index: number; length: number; before: string; after: string }[] = []
        while ((match = regex.exec(revised)) !== null) {
            const before = match[0]
            const after = replacementFn(match)
            if (before !== after) {
                matches.push({ index: match.index, length: before.length, before, after })
            }
        }
        matches.sort((a, b) => b.index - a.index)
        for (const m of matches) {
            const contextBefore = revised.substring(Math.max(0, m.index - 20), m.index)
            const contextAfter = revised.substring(m.index + m.length, Math.min(revised.length, m.index + m.length + 20))
            revised = revised.substring(0, m.index) + m.after + revised.substring(m.index + m.length)
            changes.push({
                change_id: `c${ruleChangeCounter++}`,
                type, before: m.before, after: m.after, reason, severity: 'recommended',
                context_before: contextBefore, context_after: contextAfter,
                loc: { start: m.index, end: m.index + m.after.length }
            })
        }
    }

    // Rules:
    applyRegexRule(/\s?--\s?/g, (m) => '—', 'punctuation', 'Chicago Style uses em dashes (—) without surrounding spaces.')
    // Spelling
    const commonTypos = [['definately', 'definitely'], ['seperately', 'separately'], ['occured', 'occurred'], ['recieve', 'receive'], ['teh', 'the']]
    for (const [typo, fix] of commonTypos) {
        applyRegexRule(new RegExp(`\\b${typo}\\b`, 'gi'), (m) => {
            const original = m[0]; return (original[0] && original[0] === original[0].toUpperCase()) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix
        }, 'spelling', `Corrected spelling: '${typo}' should be '${fix}'.`)
    }
    // Quotes
    applyRegexRule(/"(?=\w)/g, () => '“', 'punctuation', 'Use smart quotes.')
    applyRegexRule(/(?<=\w)"/g, () => '”', 'punctuation', 'Use smart quotes.')
    // Double spaces
    applyRegexRule(/ {2,}/g, () => ' ', 'other', 'Use single spaces between sentences.')

    return { revisedText: revised, changes }
}

// MOCK mode
async function mockRewrite(text: string): Promise<RewriteResponse> {
    await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400))
    let revisedText = text
    const changes: Change[] = []
    let changeIdCounter = 1
    // Mock logic omitted for brevity, assuming standard mock
    return { revised_text: revisedText, changes }
}

const SYSTEM_PROMPT = `You are an expert editor specializing in The Chicago Manual of Style (17th edition).
Your task is to review the user's text and provide a JSON response containing the fully revised text and a list of specific changes.
JSON Structure:
{
  "revised_text": "...",
  "changes": [
    { "change_id": "c1", "type": "spelling"|"punctuation"|"grammar"|"style"|"other", "before": "...", "after": "...", "reason": "...", "severity": "required"|"recommended"|"uncertain", "context_before": "...", "context_after": "..." }
  ]
}`

function parseResponse(textResponse: string): RewriteResponse {
    let cleanText = textResponse.trim()
    if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '')
    }
    const json = JSON.parse(cleanText)
    if (json.changes && Array.isArray(json.changes)) {
        json.changes = json.changes.filter((c: Change) => c.before !== c.after)
    }
    return json as RewriteResponse
}

async function realRewriteGemini(text: string): Promise<RewriteResponse> {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not defined')
    const { GoogleGenerativeAI } = require('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'
    const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.0, responseMimeType: "application/json" } })

    try {
        const result = await model.generateContent([{ text: SYSTEM_PROMPT }, { text: `Review and correct this text:\n\n${text}` }])
        return parseResponse(result.response.text())
    } catch (error) { console.error("Gemini API Error:", error); throw error }
}

async function realRewriteGroq(text: string): Promise<RewriteResponse> {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not defined')
    const client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
    const modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
    try {
        const response = await client.chat.completions.create({
            model: modelName, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Review and correct this text:\n\n${text}` }],
            response_format: { type: 'json_object' }, temperature: 0.0,
        })
        return parseResponse(response.choices[0].message.content || '{}')
    } catch (error) { console.error("Groq API Error:", error); throw error }
}

// Deduplication Helper
function deduplicateChanges(changes: Change[]): Change[] {
    const seen = new Set<string>()
    return changes.filter(c => {
        // Check if covered by another change with SAME textual effect but better reason?
        // For now simple duplicate check
        const normReason = c.reason.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50)
        const key = `${c.type}|${c.before}|${c.after}|${normReason}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function processAndFinalizeChanges(changes: Change[], originalText: string, revisedText: string): Change[] {
    // 1. Recalculate locations for provided changes
    let located = recalculateAllLocations(revisedText, changes)

    // 2. Compute missing changes via Diff Fallback
    // We only run this if we have a real diff engine available
    try {
        const missing = computeMissingChanges(originalText, revisedText, located)
        if (missing.length > 0) {
            if (DEBUG_LOC) console.log(`[DiffFallback] Found ${missing.length} missing changes.`)
            located = [...located, ...missing]
        }
    } catch (e) {
        console.error("[DiffFallback] Failed:", e)
    }

    // 3. Deduplicate (safeguard against weird auto-detect overlaps)
    const deduped = deduplicateChanges(located)

    // 4. Sort by location
    return deduped.sort((a, b) => (a.loc?.start ?? 0) - (b.loc?.start ?? 0))
        .map((c, i) => ({ ...c, change_id: `c${i + 1}` }))
}

export async function POST(req: NextRequest) {
    let anonId = ''
    let currentProvider = 'unknown'
    let currentModel = 'unknown'

    try {
        const { text } = await req.json()
        const cacheBypass = req.headers.get('x-cache-bypass') === '1'
        anonId = getOrSetAnonId(req)
        if (!text || text.length > MAX_TEXT_LENGTH) return errorResponse(400, 'invalid_request', 'Invalid text')

        const mode = process.env.USE_MOCK === '1' ? 'mock' : 'real'
        const provider = process.env.LLM_PROVIDER || 'gemini'
        const cacheKey = generateCacheKey(text, mode, provider)

        if (!cacheBypass && cache.has(cacheKey)) {
            console.log(`[Rewrite] event=cache_hit anon_id=${anonId}`)
            const resp = successResponse(cache.get(cacheKey)!.data)
            resp.headers.set('X-Cache', 'HIT'); resp.headers.set('X-Provider', 'cache')
            setAnonIdCookie(resp, anonId); return resp
        }

        // Run cheap rules first
        const ruleResult = applyCheapRules(text)

        if (req.headers.get('x-rules-only') === '1') {
            const finalChanges = processAndFinalizeChanges(ruleResult.changes, text, ruleResult.revisedText)
            const resp = successResponse({ revised_text: ruleResult.revisedText, changes: finalChanges })
            resp.headers.set('X-Cache', 'MISS'); resp.headers.set('X-Rules-Only', 'HIT'); resp.headers.set('X-Provider', 'rules')
            setAnonIdCookie(resp, anonId); return resp
        }

        if (pendingRequests.has(cacheKey)) {
            try {
                const data = await pendingRequests.get(cacheKey)!
                const resp = successResponse(data); resp.headers.set('X-Cache', 'MISS'); resp.headers.set('X-Dedupe', 'HIT')
                setAnonIdCookie(resp, anonId); return resp
            } catch (e) { }
        }

        const processingPromise = (async () => {
            if (process.env.MAINTENANCE_MODE === '1') throw { status: 503, json: { error: 'Service unavailable' } }
            const countMockAsExpensive = process.env.COUNT_MOCK_AS_EXPENSIVE === '1'
            const isExpensive = mode === 'real' || (mode === 'mock' && countMockAsExpensive)

            if (isExpensive) {
                const rateLimitResult = await consumeExpensiveCall(anonId)
                if (!rateLimitResult.ok) throw { status: 429, json: { error: 'Rate limit exceeded', scope: rateLimitResult.scope, retry_after_seconds: rateLimitResult.retryAfterSeconds }, retryAfter: rateLimitResult.retryAfterSeconds }
            }

            let upstreamResult: RewriteResponse
            const upstreamStart = Date.now()
            if (mode === 'mock') {
                currentProvider = 'mock'; currentModel = 'mock-v1'
                upstreamResult = await mockRewrite(ruleResult.revisedText)
            } else {
                currentProvider = provider
                if (provider === 'groq') {
                    currentModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
                    upstreamResult = await realRewriteGroq(ruleResult.revisedText)
                } else {
                    currentModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'
                    upstreamResult = await realRewriteGemini(ruleResult.revisedText)
                }
            }
            console.log(`[Rewrite] event=provider_complete provider=${currentProvider} duration=${Date.now() - upstreamStart}ms`)

            // Merge changes
            const allChanges = [...ruleResult.changes, ...upstreamResult.changes]

            // Final processing: Locating, Deduplicating, Sorting + Diff Fallback
            // Uses 'text' (original) and 'upstreamResult.revised_text' (final)
            const finalChanges = processAndFinalizeChanges(allChanges, text, upstreamResult.revised_text)

            return { revised_text: upstreamResult.revised_text, changes: finalChanges }
        })()

        pendingRequests.set(cacheKey, processingPromise)
        try {
            const data = await processingPromise
            cache.set(cacheKey, { data, timestamp: Date.now() })
            const resp = successResponse(data); resp.headers.set('X-Cache', 'MISS'); resp.headers.set('X-Provider', currentProvider); resp.headers.set('X-Model', currentModel)
            setAnonIdCookie(resp, anonId); return resp
        } finally { pendingRequests.delete(cacheKey) }

    } catch (error: any) {
        if (error.status) {
            const resp = NextResponse.json(error.json, { status: error.status })
            if (error.retryAfter) resp.headers.set('Retry-After', String(error.retryAfter))
            setAnonIdCookie(resp, anonId); return resp
        }
        return errorResponse(500, 'server_error', 'Internal error')
    }
}
