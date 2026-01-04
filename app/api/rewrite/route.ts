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

// --- Cheap Rules Engine ---
function applyCheapRules(text: string): { revisedText: string; changes: Change[] } {
    let revised = text
    const changes: Change[] = []
    let changeIdCounter = 1

    // Helper to apply regex replacement and track changes
    function applyRegexRule(
        regex: RegExp,
        replacementFn: (match: RegExpExecArray) => string,
        type: Change['type'],
        reason: string,
        getContext?: (text: string, index: number) => { before: string; after: string }
    ) {
        let match
        regex.lastIndex = 0
        const matches: { index: number; length: number; before: string; after: string; contextBefore: string; contextAfter: string }[] = []

        while ((match = regex.exec(revised)) !== null) {
            const before = match[0]
            const after = replacementFn(match)
            if (before !== after) {
                const ctx = getContext ? getContext(revised, match.index) : { before: '', after: '' }
                matches.push({
                    index: match.index,
                    length: before.length,
                    before,
                    after,
                    contextBefore: ctx.before,
                    contextAfter: ctx.after
                })
            }
        }

        for (const m of matches) {
            revised = revised.substring(0, m.index) + m.after + revised.substring(m.index + m.length)

            changes.push({
                change_id: `c${changeIdCounter++}`,
                type,
                severity: 'recommended',
                reason,
                before: m.before,
                after: m.after,
                context_before: m.contextBefore,
                context_after: m.contextAfter
            })
        }
    }

    // Default context extractor
    const getDefaultContext = (text: string, index: number) => ({
        before: text.substring(Math.max(0, index - 30), index),
        after: text.substring(index, Math.min(text.length, index + 30))
    })

    // Rules:
    applyRegexRule(/\s?--\s?/g, (m) => '—', 'punctuation', 'Em-dash spacing adjustment.', getDefaultContext)

    // Spelling
    const commonTypos = [['definately', 'definitely'], ['seperately', 'separately'], ['occured', 'occurred'], ['recieve', 'receive'], ['teh', 'the']]
    for (const [typo, fix] of commonTypos) {
        applyRegexRule(new RegExp(`\\b${typo}\\b`, 'gi'), (m) => {
            const original = m[0]
            return (original[0] && original[0] === original[0].toUpperCase()) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix
        }, 'spelling', `Corrected spelling: '${typo}' should be '${fix}'.`, getDefaultContext)
    }

    // Quotes
    applyRegexRule(/\"(?=\w)/g, () => '"', 'punctuation', 'Use smart quotes.', getDefaultContext)
    applyRegexRule(/(?<=\w)\"/g, () => '"', 'punctuation', 'Use smart quotes.', getDefaultContext)

    // Double spaces
    applyRegexRule(/ {2,}/g, () => ' ', 'spacing', 'Use single spaces between sentences.', getDefaultContext)

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

const SYSTEM_PROMPT = `You are a technical editor for The Chicago Manual of Style (17th edition).
Your task is to identify and apply technical Chicago-style revisions to the user's text.

STRICT SCOPE:
- Punctuation (e.g., em-dashes, smart quotes, comma placement)
- Spacing (e.g., single spaces between sentences)
- Capitalization (e.g., proper nouns, titles)
- Quotation and bracket placement
- Grammar fixes explicitly justified by Chicago style

DO NOT:
- Perform stylistic paraphrasing or content-level rewrites.
- Change the author's voice or word choice unless it is technically incorrect under Chicago style.
- Add, remove, or summarize information.

IDEMPOTENCY CONTRACT:
- The goal is BATCH NORMALIZATION. 
- You must identify ALL technical issues in a single pass.
- If the text is already technically correct, return the same text and an empty changes array.
- Re-running your output through this process should result in ZERO changes.

JSON Structure:
{
  "revised_text": "...",
  "changes": [
    { "change_id": "c1", "type": "spelling"|"punctuation"|"grammar"|"capitalization"|"spacing"|"hyphenation"|"numbers"|"other", "before": "...", "after": "...", "reason": "...", "severity": "required"|"recommended", "context_before": "...", "context_after": "..." }
  ]
}`

function parseResponse(textResponse: string): RewriteResponse {
    let cleanText = textResponse.trim()
    if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '')
    }
    const json = JSON.parse(cleanText)
    const changes = (json.changes && Array.isArray(json.changes)) ? json.changes
        .filter((c: any) => (c.before || '') !== (c.after || ''))
        .map((c: any) => ({
            change_id: c.change_id || c.id || `c${Math.random().toString(36).substr(2, 9)}`,
            type: c.type || 'other',
            severity: c.severity || 'recommended',
            reason: c.reason || 'Professional refinement.',
            before: c.before || '',
            after: c.after || '',
            context_before: c.context_before || '',
            context_after: c.context_after || ''
        })) : []

    return {
        revised_text: json.revised_text || '',
        changes: changes as Change[]
    }
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


// --- Robust Location Logic ---

function normalizeForContext(str: string): string {
    return str.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function getContextScore(text: string, anchorStr: string, isStart: boolean): number {
    if (!anchorStr) return 0.5
    const normalizedAnchor = normalizeForContext(anchorStr)
    const normalizedText = normalizeForContext(text)

    if (isStart) {
        // Longest common suffix
        let score = 0
        for (let i = 1; i <= Math.min(normalizedAnchor.length, normalizedText.length, 30); i++) {
            if (normalizedAnchor.slice(-i) === normalizedText.slice(-i)) {
                score = i
            } else {
                break
            }
        }
        return score
    } else {
        // Longest common prefix
        let score = 0
        for (let i = 1; i <= Math.min(normalizedAnchor.length, normalizedText.length, 30); i++) {
            if (normalizedAnchor.slice(0, i) === normalizedText.slice(0, i)) {
                score = i
            } else {
                break
            }
        }
        return score
    }
}

function locateChangeInText(text: string, change: Change): { start: number; end: number } | null {
    if (change.type === 'INSERT_AT_END') {
        const s = Math.max(0, text.length - change.after.length)
        return { start: s, end: text.length }
    }
    const searchText = change.after.trim()

    // If it's a deletion (empty after), we look for the insertion point between context_before and context_after
    if (!searchText) {
        const cb = change.context_before.trim()
        const ca = change.context_after.trim()
        if (!cb && !ca) return null

        // Try to find the transition point
        let bestIdx = -1
        let bestScore = -1

        // Simple approach: search for the concat of context
        const searchContext = (cb.slice(-15) + ca.slice(0, 15)).trim()
        if (searchContext) {
            let startSearch = 0
            while (startSearch < text.length) {
                const idx = text.indexOf(searchContext, startSearch)
                if (idx === -1) break
                // The gap is likely at idx + length of cb part
                const gapIdx = idx + cb.slice(-15).trimEnd().length
                return { start: gapIdx, end: gapIdx }
            }
        }
        return null
    }

    const candidates: { index: number; score: number; length: number }[] = []
    let searchStart = 0

    while (searchStart < text.length) {
        const idx = text.indexOf(searchText, searchStart)
        if (idx === -1) break

        const textBefore = text.substring(Math.max(0, idx - 40), idx)
        const textAfter = text.substring(idx + searchText.length, idx + searchText.length + 40)

        const scoreBefore = getContextScore(textBefore, change.context_before, true)
        const scoreAfter = getContextScore(textAfter, change.context_after, false)

        candidates.push({
            index: idx,
            score: scoreBefore + scoreAfter + 1.0,
            length: searchText.length
        })
        searchStart = idx + 1
    }

    if (candidates.length === 0) return null
    candidates.sort((a, b) => b.score - a.score)
    return { start: candidates[0].index, end: candidates[0].index + candidates[0].length }
}

const dmp = new DiffMatchPatch()

function projectCoordinates(start: number, end: number, oldText: string, newText: string): { start: number; end: number } | null {
    try {
        const diffs = dmp.diff_main(oldText, newText)
        // dmp.diff_charsToLines_ is also possible but for small text diff_main is fine
        const locStart = dmp.diff_xIndex(diffs, start)
        const locEnd = dmp.diff_xIndex(diffs, end)

        // If the entire range was deleted or becomes invalid, xIndex might still return a point.
        // We should check if the projected range makes sense.
        if (locStart === locEnd && start !== end) {
            // Range collapsed to a point, likely deleted
            return null
        }
        return { start: locStart, end: locEnd }
    } catch (e) {
        return null
    }
}

function recalculateAllLocations(text: string, changes: Change[]): Change[] {
    return changes.map(change => {
        if (change.loc) return change // Keep existing if already projected/located
        const loc = locateChangeInText(text, change)
        return { ...change, loc: loc || undefined }
    })
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

        // (Initial cheap rules handled inside processing loop for each pass)

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

            const upstreamStart = Date.now()
            let currentText = text
            let allChanges: Change[] = []
            let iterations = 0
            const MAX_ITERATIONS = 3
            let stable = false

            while (!stable && iterations < MAX_ITERATIONS) {
                iterations++
                const textAtStartOfPass = currentText

                // 1. Cheap Rules
                const passRuleResult = applyCheapRules(currentText)
                const textAfterRules = passRuleResult.revisedText

                // 2. LLM Pass
                let passResult: RewriteResponse
                if (mode === 'mock') {
                    currentProvider = 'mock'; currentModel = 'mock-v1'
                    passResult = await mockRewrite(textAfterRules)
                } else {
                    currentProvider = provider
                    if (provider === 'groq') {
                        currentModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
                        passResult = await realRewriteGroq(textAfterRules)
                    } else {
                        currentModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'
                        passResult = await realRewriteGemini(textAfterRules)
                    }
                }

                const textAfterLLM = passResult.revised_text

                // Check stability
                if (textAfterLLM === textAtStartOfPass) {
                    stable = true
                }

                // --- TRACK LOCATIONS ---

                // A. Project existing changes from textAtStartOfPass to textAfterRules
                if (textAfterRules !== textAtStartOfPass) {
                    allChanges = allChanges.map(c => {
                        if (!c.loc) return c
                        const newLoc = projectCoordinates(c.loc.start, c.loc.end, textAtStartOfPass, textAfterRules)
                        return { ...c, loc: newLoc || undefined }
                    })
                }

                // B. Add rules changes (already located relative to textAfterRules if we are careful)
                // Actually applyCheapRules uses locateChangeInText effectively or indexes.
                // Let's ensure rules changes have loc.
                const locatedRulesChanges = passRuleResult.changes.map(c => {
                    const loc = locateChangeInText(textAfterRules, c)
                    return { ...c, loc: loc || undefined }
                })
                allChanges.push(...locatedRulesChanges)

                // C. Project everything to textAfterLLM
                if (textAfterLLM !== textAfterRules) {
                    allChanges = allChanges.map(c => {
                        if (!c.loc) return c
                        const newLoc = projectCoordinates(c.loc.start, c.loc.end, textAfterRules, textAfterLLM)
                        return { ...c, loc: newLoc || undefined }
                    })
                }

                // D. Add LLM changes (located relative to textAfterLLM)
                const isSuffixOnly = textAfterLLM.startsWith(textAfterRules) && textAfterLLM.length > textAfterRules.length
                const locatedLLMChanges = passResult.changes.map(c => {
                    let finalType = c.type
                    // Detect if this is an insertion at the very end
                    if (isSuffixOnly && (!c.context_after || !c.context_after.trim()) && textAfterLLM.endsWith(c.after)) {
                        finalType = 'INSERT_AT_END'
                    }
                    const loc = locateChangeInText(textAfterLLM, { ...c, type: finalType })
                    return { ...c, type: finalType, loc: loc || undefined }
                })
                allChanges.push(...locatedLLMChanges)

                currentText = textAfterLLM
            }

            console.log(`[Rewrite] event=fixed_point_complete provider=${currentProvider} iterations=${iterations} duration=${Date.now() - upstreamStart}ms`)

            // Final re-indexing and cleanup
            const seenLocs = new Set<string>()
            const finalChanges = allChanges
                .filter(c => c.loc) // Only keep located changes
                .filter(c => {
                    const key = `${c.loc!.start}-${c.loc!.end}`
                    if (seenLocs.has(key)) return false
                    seenLocs.add(key)
                    return true
                })
                .map((c, i) => ({
                    ...c,
                    change_id: `c${i + 1}`
                }))

            return {
                revised_text: currentText,
                changes: finalChanges
            }
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
