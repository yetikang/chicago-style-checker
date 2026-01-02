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

// MOCK mode: Deterministic edits
async function mockRewrite(text: string): Promise<RewriteResponse> {
  // Simulate latency
  await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400))

  let revisedText = text
  const changes: Change[] = []
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
            before: revisedText.substring(index, afterIndex),
            after,
            reason,
            severity: 'required',
            context_before: contextBefore,
            context_after: contextAfter,
          })

          revisedText = revisedText.substring(0, index) + after + revisedText.substring(afterIndex)
          searchIndex = index + after.length
        } else {
          searchIndex = index + 1
        }
      }
    }
  }

  // Punctuation/spacing fix: double spaces -> single space
  const doubleSpaceRegex = /  +/g
  const doubleSpaceMatches = revisedText.match(doubleSpaceRegex)
  if (doubleSpaceMatches) {
    let searchIndex = 0
    while (true) {
      const index = revisedText.indexOf('  ', searchIndex)
      if (index === -1) break

      const matchLength = revisedText.substring(index).match(/^ +/)?.[0].length || 2
      const contextBefore = revisedText.substring(Math.max(0, index - 30), index)
      const contextAfter = revisedText.substring(
        index + matchLength,
        Math.min(revisedText.length, index + matchLength + 30)
      )

      changes.push({
        change_id: `c${changeIdCounter++}`,
        type: 'punctuation',
        before: ' '.repeat(matchLength),
        after: ' ',
        reason: 'Reduced multiple consecutive spaces to a single space per Chicago style',
        severity: 'required',
        context_before: contextBefore,
        context_after: contextAfter,
      })

      revisedText = revisedText.substring(0, index) + ' ' + revisedText.substring(index + matchLength)
      searchIndex = index + 1
    }
  }

  // Compute offsets for all changes in the final revised_text
  changes.forEach((change) => {
    const searchText = change.after
    const index = revisedText.indexOf(searchText)
    if (index !== -1) {
      // Check if context matches to ensure we found the right occurrence
      const beforeText = revisedText.substring(Math.max(0, index - change.context_before.length), index)
      const afterText = revisedText.substring(
        index + searchText.length,
        index + searchText.length + change.context_after.length
      )
      
      // If context matches (or is close), assign offset
      if (
        (!change.context_before || beforeText.endsWith(change.context_before.slice(-15))) &&
        (!change.context_after || afterText.startsWith(change.context_after.slice(0, 15)))
      ) {
        change.loc = {
          start: index,
          end: index + searchText.length,
        }
      }
    }
  })

  return {
    revised_text: revisedText,
    changes,
  }
}

// REAL mode: Gemini integration
async function realRewrite(text: string, requestId: string): Promise<RewriteResponse> {
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  // Import Gemini SDK dynamically to avoid issues if not installed
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(geminiApiKey)
  
  // Get model name from env or use default
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'
  const model = genAI.getGenerativeModel({ model: modelName })

  console.log(`[${requestId}] Starting Gemini API call (model: ${modelName})`)

  const prompt = `You are a copyeditor following the Chicago Manual of Style (17th edition). Your task is to edit the following paragraph for correctness and Chicago compliance.

CRITICAL RULES:
1. Do NOT change meaning, argument, information density, or overall voice/tone.
2. Do NOT add new ideas, examples, or content.
3. Do NOT fact-check or introduce external information.
4. Do NOT perform "creative rewriting" or stylistic polishing beyond correctness and Chicago compliance.
5. Use Merriam-Webster as the default spelling reference.
6. Do NOT alter proper nouns, titles, transliterations, or non-English terms unless the misspelling is unequivocal from context.
7. If uncertain about a spelling, mark it as "uncertain" severity.

Apply corrections for:
- Spelling and typos (Merriam-Webster standard)
- Grammar and syntax errors
- Punctuation and quotation marks (American conventions)
- Capitalization
- Hyphenation and dashes (hyphen / en dash / em dash)
- Numerals and dates
- Abbreviations and units
- Consistency (terminology, capitalization, spelling variants)
- Citation/footnote formatting (only if present; do not invent citations)

Return ONLY valid JSON matching this exact schema (no markdown, no prose, no code blocks):
{
  "revised_text": "string",
  "changes": [
    {
      "change_id": "c1",
      "type": "spelling|grammar|punctuation|capitalization|hyphenation|numbers|consistency|citation_format|other",
      "before": "string",
      "after": "string",
      "reason": "string",
      "severity": "required|recommended|optional|uncertain",
      "context_before": "string",
      "context_after": "string"
    }
  ]
}

The changes array must be exhaustive: every non-trivial edit must appear. Use short, local substrings for "before" and "after". Use 10-30 characters for context_before and context_after.

Paragraph to edit:
${text}`

  try {
    // Create timeout promise for 90s timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout after 90 seconds')), 90000)
    })

    // Call Gemini API with timeout
    const result = await Promise.race([
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
        },
      }),
      timeoutPromise,
    ])

    const response = await result.response
    const content = response.text()

    if (!content) {
      throw new Error('Empty response from Gemini')
    }

    // Parse JSON response - handle potential markdown code blocks
    let jsonContent = content.trim()
    
    // Remove markdown code blocks if present
    if (jsonContent.startsWith('```')) {
      const lines = jsonContent.split('\n')
      const startIndex = lines.findIndex(line => line.trim().startsWith('```'))
      const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.trim().endsWith('```'))
      if (startIndex !== -1 && endIndex !== -1) {
        jsonContent = lines.slice(startIndex + 1, endIndex).join('\n').trim()
      }
    }

    let parsed: RewriteResponse
    try {
      parsed = JSON.parse(jsonContent) as RewriteResponse
    } catch (parseError) {
      console.error(`[${requestId}] JSON parse error:`, parseError)
      console.error(`[${requestId}] Raw content:`, content.substring(0, 500))
      throw new Error('Failed to parse JSON from model output')
    }

    // Validate response structure
    if (!parsed.revised_text || !Array.isArray(parsed.changes)) {
      throw new Error('Invalid response structure: missing revised_text or changes array')
    }

    // Server-side: compute offsets (start/end) for each change in revised_text
    const normalizeForMatching = (str: string): string => {
      return str
        .replace(/\s+/g, ' ')
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/[–—]/g, '-')
        .trim()
    }

    const locateChange = (
      revisedText: string,
      change: Change
    ): { start: number; end: number } | null => {
      const searchText = change.after.trim()
      const contextBefore = change.context_before.trim()
      const contextAfter = change.context_after.trim()

      // Strategy 1: Full context pattern match
      if (contextBefore || contextAfter) {
        const fullPattern = (contextBefore + ' ' + searchText + ' ' + contextAfter).trim()
        const patternIndex = revisedText.indexOf(fullPattern)
        if (patternIndex !== -1) {
          const start = patternIndex + contextBefore.length + (contextBefore ? 1 : 0)
          return { start, end: start + searchText.length }
        }
      }

      // Strategy 2: Normalized context pattern match
      if (contextBefore || contextAfter) {
        const normalizedRevised = normalizeForMatching(revisedText)
        const normalizedContextBefore = normalizeForMatching(contextBefore)
        const normalizedContextAfter = normalizeForMatching(contextAfter)
        const normalizedSearch = normalizeForMatching(searchText)
        const normalizedPattern = (
          normalizedContextBefore + ' ' + normalizedSearch + ' ' + normalizedContextAfter
        ).trim()

        const patternIndex = normalizedRevised.indexOf(normalizedPattern)
        if (patternIndex !== -1) {
          // Map back to original text - approximate position
          // Find the actual position by searching around the normalized index
          const searchStart = Math.max(0, patternIndex - 50)
          const searchEnd = Math.min(revisedText.length, patternIndex + normalizedPattern.length + 50)
          const candidate = revisedText.substring(searchStart, searchEnd)
          const normalizedCandidate = normalizeForMatching(candidate)

          if (normalizedCandidate.includes(normalizedPattern)) {
            const localIndex = normalizedCandidate.indexOf(normalizedPattern)
            const globalIndex = searchStart + localIndex
            const start = globalIndex + normalizedContextBefore.length + (normalizedContextBefore ? 1 : 0)
            return { start, end: start + searchText.length }
          }
        }
      }

      // Strategy 3: Direct substring search with context validation
      let searchStart = 0
      while (searchStart < revisedText.length) {
        const index = revisedText.indexOf(searchText, searchStart)
        if (index === -1) break

        // Validate context
        const beforeText = revisedText.substring(
          Math.max(0, index - Math.max(contextBefore.length, 40)),
          index
        )
        const afterText = revisedText.substring(
          index + searchText.length,
          index + searchText.length + Math.max(contextAfter.length, 40)
        )

        const normalizedBefore = normalizeForMatching(beforeText)
        const normalizedAfter = normalizeForMatching(afterText)
        const normalizedContextBefore = normalizeForMatching(contextBefore)
        const normalizedContextAfter = normalizeForMatching(contextAfter)

        const contextBeforeMatch =
          contextBefore.length === 0 ||
          normalizedBefore.endsWith(
            normalizedContextBefore.slice(-Math.min(normalizedContextBefore.length, 25))
          )
        const contextAfterMatch =
          contextAfter.length === 0 ||
          normalizedAfter.startsWith(
            normalizedContextAfter.slice(0, Math.min(normalizedContextAfter.length, 25))
          )

        if (contextBeforeMatch && contextAfterMatch) {
          return { start: index, end: index + searchText.length }
        }

        searchStart = index + 1
      }

      return null
    }

    // Compute offsets for all changes, handling overlaps
    const changeOffsets: Array<{ change: Change; loc: { start: number; end: number } }> = []
    const unmatchedChangeIds: string[] = []

    parsed.changes.forEach((change) => {
      const loc = locateChange(parsed.revised_text, change)
      if (loc) {
        changeOffsets.push({ change, loc })
      } else {
        unmatchedChangeIds.push(change.change_id)
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[${requestId}] Change ${change.change_id} could not be located: after="${change.after}"`
          )
        }
      }
    })

    // Sort by start position and handle overlaps (prioritize earlier change_id)
    changeOffsets.sort((a, b) => {
      if (a.loc.start !== b.loc.start) return a.loc.start - b.loc.start
      return a.change.change_id.localeCompare(b.change.change_id)
    })

    const finalOffsets: Array<{ change: Change; loc: { start: number; end: number } }> = []
    let lastEnd = 0

    changeOffsets.forEach((item) => {
      // Check for overlap
      if (item.loc.start >= lastEnd) {
        finalOffsets.push(item)
        lastEnd = item.loc.end
        // Attach loc to change
        item.change.loc = item.loc
      } else {
        // Overlap detected - mark as unlocated
        unmatchedChangeIds.push(item.change.change_id)
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[${requestId}] Change ${item.change.change_id} overlaps with previous change, marking as unlocated`
          )
        }
      }
    })

    if (unmatchedChangeIds.length > 0 && process.env.NODE_ENV === 'development') {
      console.warn(
        `[${requestId}] ${unmatchedChangeIds.length} changes could not be located:`,
        unmatchedChangeIds
      )
    }

    return parsed
  } catch (error: any) {
    // Handle timeout
    if (error.name === 'AbortError' || error.message?.includes('timeout') || error.code === 'ECONNABORTED') {
      throw { status: 504, type: 'timeout', message: 'Gemini request timed out after 90 seconds.' }
    }

    // Map Gemini errors to appropriate HTTP status codes
    if (error.status === 401 || error.statusCode === 401) {
      throw { status: 401, type: 'auth', message: 'Invalid API key' }
    }
    if (error.status === 429 || error.statusCode === 429) {
      console.log(`[${requestId}] Gemini rate limit (429) - no retry`)
      throw { status: 429, type: 'rate_limit', message: 'Rate limit exceeded. Please wait and retry.' }
    }
    
    // Handle JSON parsing errors
    if (error.message?.includes('parse') || error.message?.includes('JSON')) {
      throw { status: 502, type: 'bad_model_output', message: 'Model returned invalid JSON. Please try again.' }
    }

    throw { status: 502, type: 'upstream_error', message: error.message || 'Gemini API error' }
  }
}

export async function POST(request: NextRequest) {
  // Generate unique request ID for logging
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  
  try {
    // Check for mock error flag
    const url = new URL(request.url)
    const mockError = url.searchParams.get('mockError') === '1'
    const useMock = process.env.USE_MOCK === '1'

    if (useMock && mockError) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return errorResponse(504, 'timeout', 'Mock timeout for UI testing.')
    }

    // Parse request body
    let body
    try {
      body = await request.json()
    } catch {
      return errorResponse(400, 'validation', 'Invalid JSON in request body')
    }

    // Validate input
    const { text } = body
    if (typeof text !== 'string') {
      return errorResponse(400, 'validation', 'Field "text" must be a string')
    }

    if (!text.trim()) {
      return errorResponse(400, 'validation', 'Field "text" cannot be empty')
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return errorResponse(
        400,
        'validation',
        `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`
      )
    }

    // Route to MOCK or REAL mode
    let result: RewriteResponse
    if (useMock) {
      result = await mockRewrite(text)
    } else {
      try {
        result = await realRewrite(text, requestId)
      } catch (error: any) {
        if (error.status && error.type && error.message) {
          return errorResponse(error.status, error.type, error.message)
        }
        if (error.message === 'GEMINI_API_KEY not configured') {
          return errorResponse(500, 'not_configured', 'Gemini API key is not configured')
        }
        return errorResponse(502, 'upstream_error', error.message || 'Unknown error')
      }
    }

    return successResponse(result)
  } catch (error: any) {
    return errorResponse(500, 'internal_error', error.message || 'Internal server error')
  }
}

