import { NextRequest, NextResponse } from 'next/server'
import { RewriteResponse, Change } from '@/types'

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

function generateCacheKey(text: string, mode: string): string {
  // Normalize basics for cache key
  const normalized = text.trim().replace(/\r\n/g, '\n')
  // Simple hash for key
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return `${hash}_${mode}_${PROMPT_VERSION}`
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
            // It starts inside the replaced region? This implies overlap/conflict.
            // Since we apply rules sequentially, the previous rule saw the "old" text.
            // But wait, if we process matches in reverse order for THIS rule,
            // and previous rules have already run...
            // Only strictly downstream changes should shift.
            // If change.loc.start > m.index, it is downstream.
            change.loc.start += delta
            change.loc.end += delta
          }
        }
      }

      // Add change
      changes.push({
        change_id: `c${ruleChangeCounter++}`,
        type,
        before: m.before, // Display " -- "
        after: m.after,   // Display "—"
        reason,
        severity: 'recommended', // Default for cheap rules
        context_before: contextBefore,
        context_after: contextAfter,
        loc: { start: m.index, end: m.index + m.after.length } // We know the location exactly!
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

  // B. Spelling (simple whole word)
  // Ordered by length descending to catch longer phrases if we had them? No need for single words.
  const commonTypos = [
    ['definately', 'definitely'],
    ['seperately', 'separately'],
    ['occured', 'occurred'],
    ['recieve', 'receive'],
    ['teh', 'the']
  ]

  for (const [typo, fix] of commonTypos) {
    if (typo === fix) continue // Skip if same
    applyRegexRule(
      new RegExp(`\\b${typo}\\b`, 'gi'), // Whole word, case insensitive
      (m) => {
        // preserve case?
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
  // Double quotes: " word " -> “ word ”
  // Simplistic: " at start of word -> “, " at end -> ”
  applyRegexRule(
    /"(?=\w)/g, // " followed by word char -> Opening
    () => '“',
    'punctuation',
    'Use smart quotes.'
  )
  applyRegexRule(
    /(?<=\w)"/g, // word char followed by " -> Closing
    () => '”',
    'punctuation',
    'Use smart quotes.'
  )
  // Single quotes skipped as requested (conservative)

  // D. Double spaces
  // "  " -> " "
  applyRegexRule(
    / {2,}/g, // 2 or more spaces
    () => ' ',
    'other',
    'Use single spaces between sentences.'
  )

  return { revisedText: revised, changes }
}

// MOCK mode: Deterministic edits
async function mockRewrite(text: string): Promise<RewriteResponse> {
  // Simulate latency
  await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400))

  let revisedText = text
  const changes: Change[] = []

  // NOTE: In the new pipeline, applyCheapRules runs BEFORE this.
  // So 'teh', double spaces, etc. might already be fixed.
  // We keep this logic here just in case mock is called directly or to handle anything missed.
  // But strictly speaking, for the specific test cases handled by cheap rules, this might be redundant.
  // That is acceptable.

  let changeIdCounter = 1

  // Helper to add a change
  function addChange(
    before: string,
    after: string,
    type: Change['type'],
    reason: string,
    severity: Change['severity'] = 'required'
  ) {
    // Find the position in the original text
    const index = revisedText.indexOf(before)
    if (index === -1) return false

    // Get context (10-30 chars)
    const contextBefore = revisedText.substring(
      Math.max(0, index - 30),
      index
    )
    const contextAfter = revisedText.substring(
      index + before.length,
      Math.min(revisedText.length, index + before.length + 30)
    )

    changes.push({
      change_id: `c${changeIdCounter++}`,
      type,
      before,
      after,
      reason,
      severity,
      context_before: contextBefore,
      context_after: contextAfter,
    })

    // Apply the change
    revisedText = revisedText.replace(before, after)
    return true
  }

  // Whole-word replacements (using word boundaries)
  const wordReplacements = [
    {
      before: 'teh',
      after: 'the',
      reason: "Corrected spelling: 'teh' should be 'the' (Merriam-Webster standard)",
    },
    {
      before: 'recieve',
      after: 'receive',
      reason: "Corrected spelling: 'recieve' should be 'receive' (i before e except after c)",
    },
    {
      before: 'occured',
      after: 'occurred',
      reason: "Corrected spelling: 'occured' should be 'occurred' (double 'r')",
    },
  ]

  // Apply whole-word replacements
  for (const { before, after, reason } of wordReplacements) {
    // Use regex with word boundaries to match whole words only
    const regex = new RegExp(`\\b${before}\\b`, 'gi')
    const matches = text.match(regex)
    if (matches) {
      // Find each occurrence and add change
      let searchIndex = 0
      while (true) {
        const index = revisedText.toLowerCase().indexOf(before.toLowerCase(), searchIndex)
        if (index === -1) break

        // Check if it's a whole word (preceded/followed by non-word char or boundary)
        const beforeChar = index > 0 ? revisedText[index - 1] : ' '
        const afterIndex = index + before.length
        const afterChar = afterIndex < revisedText.length ? revisedText[afterIndex] : ' '
        const isWordBoundary = /[^a-zA-Z]/.test(beforeChar) && /[^a-zA-Z]/.test(afterChar)

        if (isWordBoundary) {
          const contextBefore = revisedText.substring(Math.max(0, index - 30), index)
          const contextAfter = revisedText.substring(
            afterIndex,
            Math.min(revisedText.length, afterIndex + 30)
          )

          changes.push({
            change_id: `c${changeIdCounter++}`,
            type: 'spelling',
            before,
            after,
            reason,
            severity: 'required', // Assuming 'severity' is defined or passed
            context_before: contextBefore,
            context_after: contextAfter,
          })

          // Apply correction
          const original = revisedText.substring(index, index + before.length)
          revisedText =
            revisedText.substring(0, index) +
            after +
            revisedText.substring(index + original.length)
        }
        searchIndex = index + 1
      }
    }
  }

  // Calculate offsets for highlighting
  changes.forEach(change => {
    // Simple mock logic for highlighting (imperfect but sufficient for mock)
    // We search in the FINAL revised text
    // LIMITATION: This doesn't handle multiple identical corrections perfectly in mock mode
    // but the Real Mode logic is much more robust.
    const search = change.after
    const index = revisedText.indexOf(search)
    if (index !== -1) {
      change.loc = { start: index, end: index + search.length }
    }
  })

  return { revised_text: revisedText, changes }
}

async function realRewrite(text: string): Promise<RewriteResponse> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not defined')
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

  // Use user-specified model or default
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.2, // Low temp for stability
      responseMimeType: "application/json"
    }
  })

  // System prompt optimized for Chicago Style
  const systemPrompt = `You are an expert editor specializing in The Chicago Manual of Style (17th edition).
Your task is to review the user's text and provide a JSON response containing the fully revised text and a list of specific changes.

INPUT:
The user will provide a text paragraph.

OUTPUT FORMAT:
Return a single JSON object with this exact structure:
{
  "revised_text": "The full text after all corrections have been applied",
  "changes": [
    {
      "change_id": "c1",
      "type": "spelling" | "punctuation" | "grammar" | "style" | "formatting",
      "before": "substring from original text",
      "after": "replacement substring",
      "reason": "Brief explanation of the Chicago Style rule applied",
      "severity": "required" | "recommended" | "uncertain",
      "context_before": "up to 3 words before the change",
      "context_after": "up to 3 words after the change"
    }
  ]
}

CRITICAL RULES:
1. Preserve the original meaning and specific wording choice unless it violates a rule.
2. If no changes are needed, return the original text in "revised_text" and an empty "changes" array.
3. Every change listed in the "changes" array MUST be reflected in "revised_text".
4. Do NOT include changes if the text in "before" and "after" is identical.
5. Use Merriam-Webster as the default spelling reference.
6. Do NOT alter proper nouns, titles, transliterations, or non-English terms unless the misspelling is unequivocal from context.
7. If uncertain about a spelling, mark it as "uncertain" severity.
8. STABILITY CLAUSE: For optional stylistic choices (e.g., optional commas around introductory/parenthetical adverbs), PRESERVE the author's original choice unless it causes genuine ambiguity or error.
9. CAPITALIZATION CONSTRAINT: Do NOT lowercase capitalized terms used as proper nouns (especially religious titles, honorifics, or geopolitical designations) unless you are 100% certain it is a typo. When in doubt, PRESERVE AUTHOR CAPITALIZATION.
   - EXPLICITLY PRESERVE: "Shaykhs", "Sheikhs", "Imams", "Eastern", "Western", "Biblical", "Scriptural" if capitalized by the author. Do not change these to lowercase.

Apply corrections for:
- Spelling and typos (Merriam-Webster standard)
- Punctuation (serial commas, commas with independent clauses, em-dashes without spaces)
- Hyphenation (compound modifiers)
- Number formatting (spell out one through ninety-nine, use numerals for 100+)
- Capitalization (titles, proper nouns)
- Grammar (agreement, syntax)

IMPORTANT: The input text may have already undergone basic formatting cleanup (e.g. smart quotes, em-dashes). Respect these changes and focus on higher-level editing.
`

  try {
    const result = await model.generateContent([
      { text: systemPrompt },
      { text: `Review and correct this text according to Chicago Style:\n\n${text}` }
    ])

    const response = result.response
    const textResponse = response.text()

    // Parse JSON
    try {
      // CLEANUP: Remove markdown code blocks if present
      let cleanText = textResponse.trim()
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(json)?\n?/, '').replace(/\n?```$/, '')
      }

      const json = JSON.parse(cleanText)

      // Validation: remove no-op changes
      if (json.changes && Array.isArray(json.changes)) {
        json.changes = json.changes.filter((c: Change) => c.before !== c.after)
      }

      // LOCATE CHANGES: Compute Start/End offsets server-side 
      const normalizeForMatching = (str: string): string => {
        return str
          .replace(/[.,;:"'?!()[\]{}]/g, '') // Remove punctuation
          .replace(/\s+/g, ' ')               // Collapse spaces
          .replace(/[–—]/g, '-')              // Normalize dashes 
          .trim()
          .toLowerCase()
      }

      const locateChange = (
        revisedText: string,
        change: Change
      ): { start: number; end: number } | null => {
        const searchText = change.after.trim()
        const contextBefore = change.context_before.trim()
        const contextAfter = change.context_after.trim()

        // Strategy 1: Exact search + Normalized Context Check
        let searchStart = 0
        while (searchStart < revisedText.length) {
          const index = revisedText.indexOf(searchText, searchStart)
          if (index === -1) break

          // Match context?
          const beforeContextText = revisedText.substring(Math.max(0, index - Math.max(contextBefore.length, 40)), index)
          const afterContextText = revisedText.substring(index + searchText.length, index + searchText.length + Math.max(contextAfter.length, 40))

          const nb = normalizeForMatching(beforeContextText)
          const na = normalizeForMatching(afterContextText)
          const ncb = normalizeForMatching(contextBefore)
          const nca = normalizeForMatching(contextAfter)

          const preMatch = ncb.length === 0 || nb.endsWith(ncb.slice(-Math.min(ncb.length, 25)))
          const postMatch = nca.length === 0 || na.startsWith(nca.slice(0, Math.min(nca.length, 25)))

          if (preMatch && postMatch) {
            return { start: index, end: index + searchText.length }
          }
          searchStart = index + 1
        }

        // Strategy 2: Unique match
        const firstIndex = revisedText.indexOf(searchText)
        if (firstIndex !== -1 && revisedText.indexOf(searchText, firstIndex + 1) === -1) {
          return { start: firstIndex, end: firstIndex + searchText.length }
        }

        return null
      }

      // Augment changes with 'loc'
      if (json.changes) {
        json.changes = json.changes.map((c: Change) => {
          const loc = locateChange(json.revised_text, c)
          if (loc) return { ...c, loc }
          return c
        })
      }

      return json as RewriteResponse
    } catch (e) {
      console.error("JSON Parse Error from Gemini:", e)
      throw new Error("Failed to parse valid JSON from model response")
    }

  } catch (error) {
    console.error("Gemini API Error:", error)
    throw error
  }
}

export async function POST(req: NextRequest) {
  // 0. AUTHENTICATION CHECK
  if (process.env.DISABLE_PASSWORD_GATE !== '1') {
    const authCookie = req.cookies.get('cms_auth')
    if (authCookie?.value !== '1') {
      return errorResponse(401, 'unauthorized', 'Unauthorized: Please log in using the site password.')
    }
  }

  try {
    const { text } = await req.json()

    if (!text || text.length > MAX_TEXT_LENGTH) {
      return errorResponse(400, 'invalid_request', 'Invalid text provided')
    }

    const mode = process.env.USE_MOCK === '1' ? 'mock' : 'real'
    const cacheKey = generateCacheKey(text, mode)

    // 1. CACHE CHECK
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey)!
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        const resp = successResponse(cached.data)
        resp.headers.set('X-Cache', 'HIT')
        return resp
      } else {
        cache.delete(cacheKey) // Expired
      }
    }

    // 2. DEDUPLICATION
    if (pendingRequests.has(cacheKey)) {
      const pending = pendingRequests.get(cacheKey)!
      const data = await pending
      const resp = successResponse(data)
      resp.headers.set('X-Cache', 'MISS')
      resp.headers.set('X-Dedupe', 'HIT')
      return resp
    }

    // Process Request
    const processingPromise = (async () => {
      // 3. CHEAP RULES PRE-PASS
      const ruleResult = applyCheapRules(text)
      let currentText = ruleResult.revisedText
      let finalChanges = [...ruleResult.changes]

      // 4. CALL UPSTREAM (Mock or Gemini)
      // If rules changed text, we send NEW text to Gemini
      let upstreamResult: RewriteResponse
      // NOTE: In Mock mode, mockRewrite also does some regexes, but they should be redundant
      if (mode === 'mock') {
        upstreamResult = await mockRewrite(currentText)
      } else {
        upstreamResult = await realRewrite(currentText)
      }

      // 5. MERGE RESULTS
      // Gemini returns changes relative to currentText (which is ruleResult.revisedText)
      // We need to merge them.
      // Actually, if Gemini returns the *full* revised text, that becomes our final text.
      // The changes Gemini reports are "c1, c2..." starting from 1 usually.
      // We need to offset their IDs.

      // Renumber Gemini changes
      // First change id in rules is c1.
      // We assume finalChanges has ids like c1, c2, c3.
      const nextIdStart = finalChanges.length + 1
      const renumberedGeminiChanges = upstreamResult.changes.map((c, i) => ({
        ...c,
        change_id: `c${nextIdStart + i}`
      }))

      finalChanges = [...finalChanges, ...renumberedGeminiChanges]

      // Final response
      const responseData = {
        revised_text: upstreamResult.revised_text,
        changes: finalChanges
      }

      return responseData
    })()

    pendingRequests.set(cacheKey, processingPromise)

    try {
      const data = await processingPromise
      // Cache success
      cache.set(cacheKey, { data, timestamp: Date.now() })

      const resp = successResponse(data)
      resp.headers.set('X-Cache', 'MISS')
      resp.headers.set('X-Dedupe', 'MISS')
      return resp
    } finally {
      pendingRequests.delete(cacheKey)
    }

  } catch (error) {
    console.error('Error in rewrite route:', error)
    return errorResponse(500, 'server_error', 'Internal server error')
  }
}
