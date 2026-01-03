import { NextRequest, NextResponse } from 'next/server'
import { RewriteResponse, Change } from '@/types'
import { getOrSetAnonId, setAnonIdCookie, consumeExpensiveCall } from '@/lib/ratelimit'
import OpenAI from 'openai'

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

    // Find all matches first
    const matches: { index: number; length: number; before: string; after: string }[] = []

    while ((match = regex.exec(revised)) !== null) {
      const before = match[0]
      const after = replacementFn(match)
      if (before !== after) {
        matches.push({
          index: match.index,
          length: before.length,
          before,
          after
        })
      }
    }

    // Sort reverse to apply safely without affecting indices of earlier matches
    matches.sort((a, b) => b.index - a.index)

    for (const m of matches) {
      // Get context from CURRENT revised state
      const contextBefore = revised.substring(Math.max(0, m.index - 20), m.index)
      const contextAfter = revised.substring(m.index + m.length, Math.min(revised.length, m.index + m.length + 20))

      // Calculate length difference
      const delta = m.after.length - m.before.length

      // Update string
      revised = revised.substring(0, m.index) + m.after + revised.substring(m.index + m.length)

      // CRITICAL: Shift INDICES of all previously recorded changes if they are downstream
      if (delta !== 0) {
        for (const change of changes) {
          // If a previous change starts AFTER this modification point, shift it
          if (change.loc && change.loc.start >= m.index + m.before.length) {
            change.loc.start += delta
            change.loc.end += delta
          } else if (change.loc && change.loc.start > m.index) {
            change.loc.start += delta
            change.loc.end += delta
          }
        }
      }

      // Add change
      changes.push({
        change_id: `c${ruleChangeCounter++}`,
        type,
        before: m.before,
        after: m.after,
        reason,
        severity: 'recommended',
        context_before: contextBefore,
        context_after: contextAfter,
        loc: { start: m.index, end: m.index + m.after.length }
      })
    }
  }

  // A. Em-dash "--"
  applyRegexRule(
    /\s?--\s?/g,
    (m) => '—',
    'punctuation',
    'Chicago Style uses em dashes (—) without surrounding spaces.'
  )

  // B. Spelling
  const commonTypos = [
    ['definately', 'definitely'],
    ['seperately', 'separately'],
    ['occured', 'occurred'],
    ['recieve', 'receive'],
    ['teh', 'the']
  ]

  for (const [typo, fix] of commonTypos) {
    applyRegexRule(
      new RegExp(`\\b${typo}\\b`, 'gi'),
      (m) => {
        const original = m[0]
        if (original[0] && original[0] === original[0].toUpperCase()) {
          return fix.charAt(0).toUpperCase() + fix.slice(1)
        }
        return fix
      },
      'spelling',
      `Corrected spelling: '${typo}' should be '${fix}'.`
    )
  }

  // C. Quotes
  applyRegexRule(
    /"(?=\w)/g,
    () => '“',
    'punctuation',
    'Use smart quotes.'
  )
  applyRegexRule(
    /(?<=\w)"/g,
    () => '”',
    'punctuation',
    'Use smart quotes.'
  )

  // D. Double spaces
  applyRegexRule(
    / {2,}/g,
    () => ' ',
    'other',
    'Use single spaces between sentences.'
  )

  return { revisedText: revised, changes }
}

// MOCK mode
async function mockRewrite(text: string): Promise<RewriteResponse> {
  await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400))
  let revisedText = text
  const changes: Change[] = []
  let changeIdCounter = 1

  function addChange(
    before: string,
    after: string,
    type: Change['type'],
    reason: string,
    severity: Change['severity'] = 'required'
  ) {
    const index = revisedText.indexOf(before)
    if (index === -1) return false
    const contextBefore = revisedText.substring(Math.max(0, index - 30), index)
    const contextAfter = revisedText.substring(index + before.length, Math.min(revisedText.length, index + before.length + 30))
    changes.push({
      change_id: `c${changeIdCounter++}`,
      type, before, after, reason, severity, context_before: contextBefore, context_after: contextAfter,
    })
    revisedText = revisedText.replace(before, after)
    return true
  }

  const wordReplacements = [
    { before: 'teh', after: 'the', reason: "Corrected spelling: 'teh' should be 'the'." },
  ]

  for (const { before, after, reason } of wordReplacements) {
    const regex = new RegExp(`\\b${before}\\b`, 'gi')
    if (text.match(regex)) {
      addChange(before, after, 'spelling', reason)
    }
  }

  changes.forEach(change => {
    const search = change.after
    const index = revisedText.indexOf(search)
    if (index !== -1) {
      change.loc = { start: index, end: index + search.length }
    }
  })

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

function parseAndLocateResponse(textResponse: string, originalText: string): RewriteResponse {
  let cleanText = textResponse.trim()
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '')
  }
  const json = JSON.parse(cleanText)
  if (json.changes && Array.isArray(json.changes)) {
    json.changes = json.changes.filter((c: Change) => c.before !== c.after)
  }

  const normalizeForMatching = (str: string): string => {
    return str.replace(/[.,;:"'?!()[\]{}]/g, '').replace(/\s+/g, ' ').replace(/[–—]/g, '-').trim().toLowerCase()
  }

  const locateChange = (revisedText: string, change: Change): { start: number; end: number } | null => {
    const searchText = change.after.trim()
    const contextBefore = change.context_before.trim()
    const contextAfter = change.context_after.trim()
    let searchStart = 0
    while (searchStart < revisedText.length) {
      const index = revisedText.indexOf(searchText, searchStart)
      if (index === -1) break
      const beforeContextText = revisedText.substring(Math.max(0, index - Math.max(contextBefore.length, 40)), index)
      const afterContextText = revisedText.substring(index + searchText.length, index + searchText.length + Math.max(contextAfter.length, 40))
      const nb = normalizeForMatching(beforeContextText)
      const na = normalizeForMatching(afterContextText)
      const ncb = normalizeForMatching(contextBefore)
      const nca = normalizeForMatching(contextAfter)
      const preMatch = ncb.length === 0 || nb.endsWith(ncb.slice(-Math.min(ncb.length, 25)))
      const postMatch = nca.length === 0 || na.startsWith(nca.slice(0, Math.min(nca.length, 25)))
      if (preMatch && postMatch) return { start: index, end: index + searchText.length }
      searchStart = index + 1
    }
    const firstIndex = revisedText.indexOf(searchText)
    if (firstIndex !== -1 && revisedText.indexOf(searchText, firstIndex + 1) === -1) return { start: firstIndex, end: firstIndex + searchText.length }
    return null
  }

  if (json.changes) {
    json.changes = json.changes.map((c: Change) => {
      const loc = locateChange(json.revised_text, c)
      if (loc) return { ...c, loc }
      return c
    })
  }
  return json as RewriteResponse
}

async function realRewriteGemini(text: string): Promise<RewriteResponse> {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not defined')
  const { GoogleGenerativeAI } = require('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'
  const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { temperature: 0.2, responseMimeType: "application/json" } })

  try {
    const result = await model.generateContent([{ text: SYSTEM_PROMPT }, { text: `Review and correct this text:\n\n${text}` }])
    return parseAndLocateResponse(result.response.text(), text)
  } catch (error) { console.error("Gemini API Error:", error); throw error }
}

async function realRewriteGroq(text: string): Promise<RewriteResponse> {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not defined')
  const client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  const modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

  try {
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Review and correct this text:\n\n${text}` }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    })
    return parseAndLocateResponse(response.choices[0].message.content || '{}', text)
  } catch (error) { console.error("Groq API Error:", error); throw error }
}

function reorderAndDedupeChanges(changes: Change[]): Change[] {
  return [...changes].sort((a, b) => (a.loc?.start ?? 0) - (b.loc?.start ?? 0)).map((c, i) => ({ ...c, change_id: `c${i + 1}` }))
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

    const ruleResult = applyCheapRules(text)
    if (req.headers.get('x-rules-only') === '1') {
      const resp = successResponse({ revised_text: ruleResult.revisedText, changes: reorderAndDedupeChanges(ruleResult.changes) })
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

      const shiftedUpstreamChanges = upstreamResult.changes.map(c => ({ ...c, change_id: `g${c.change_id}` }))
      return { revised_text: upstreamResult.revised_text, changes: reorderAndDedupeChanges([...ruleResult.changes, ...shiftedUpstreamChanges]) }
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
