# Chicago Technical Editor — SPEC.md

## 1. Product Overview

**Chicago Technical Editor** is a minimalist, academic-style web utility that performs Chicago Manual of Style (CMoS)–informed paragraph-level copyediting. Users paste a paragraph and receive:

1) a revised paragraph,
2) visual highlights showing edits (red changes),
3) a concise bullet list explaining what was changed and why,

with an interaction that links each bullet to the corresponding location in the revised paragraph.

Primary goal: replicate the practical “ChatGPT editing + feedback” experience in a cleaner, more efficient, non-chat UI.

---

## 2. Scope (V1)

### Input
- **Paragraph-level only** (single textarea input).
- Users paste plain text (no file upload, no docx parsing in V1).

### Editing Coverage (Broad)
Apply **any improvements that a CMoS-informed copyeditor would consider appropriate** at the paragraph level, including (non-exhaustive):
- spelling/typos (including common misspellings)
- grammar and syntax errors
- punctuation and quotation marks (American conventions)
- capitalization
- italics vs quotation conventions where applicable
- hyphenation and dashes (hyphen / en dash / em dash)
- numerals and dates
- abbreviations and units
- consistency (terminology, capitalization, spelling variants)
- **citation/footnote formatting only when present** (do not invent citations)

### Strict Boundaries (Must Not)
- **Do not change meaning, argument, information density, or overall voice/tone.**
- **Do not add new ideas, examples, or content.**
- **Do not fact-check or introduce external information.**
- **Do not perform “creative rewriting” or stylistic polishing beyond correctness and Chicago compliance.**

### Spelling Policy (Required)
- Identify and correct **common misspellings** and clear typos.
- Use **Merriam-Webster** as the default spelling reference (Chicago practice).
- Maintain internal consistency of spelling throughout the paragraph.
- Do **not** “correct” proper nouns, titles, transliterations, or non-English terms unless the misspelling is unequivocal from context.
  - If uncertain, do not change automatically; report as **uncertain** in the change list.

---

## 3. Output Requirements

The app must present all three outputs after a run:

1) **Revised paragraph** (`revised_text`)
2) **Highlighted revised paragraph**
   - Edited content is shown in **red** (insertions/replacements).
   - Deletions may be shown as red strikethrough or omitted, but the approach must be consistent and clear.
3) **Changes list (bullet points)**
   - Each item explains **what changed** and **why** (concise, like ChatGPT feedback but shorter).

### Hover-to-Locate Interaction (Required)
- When the user hovers a bullet item, the corresponding location in the revised paragraph is additionally highlighted (e.g., subtle background highlight/underline) to help users locate the edit.
- Highlight clears on mouse leave.
- (Optional future enhancement) Reverse linking: hovering a highlighted span highlights its bullet item.

---

## 4. UI / UX Requirements

### Visual Style
- Minimalist, academic, high-contrast, generous whitespace.
- No flashy animations; subtle transitions only if necessary.

### Layout (Recommended)
- Two-column layout:
  - Left: Original textarea
  - Right: Revised output with red highlights
- Below or adjacent: Changes (bulleted list)

### Controls (Required)
- **Apply/Rewrite** button (runs the edit)
- **Copy revised text** button
- **Clear** button
- Clear **Loading** state and **Error** state messaging

### Toggles (Recommended)
- **Show highlights on/off** (controls red diff rendering)

---

## 5. Technical Architecture (Implementation Guidance)

### General
- Develop in Cursor; codebase should be readable and maintainable.
- API keys must never appear in client-side code.

### Suggested Stack (Not strictly required)
- Frontend: React (Next.js or Vite React) + Tailwind CSS
- Backend: API route (Next.js) or Node/Express endpoint
- LLM: OpenAI API called from server only

### Request / Response Contract (Required)

#### Client → Server
`POST /api/rewrite`
```json
{ "text": "string" }
```

**Validation**
- Reject empty input.
- Enforce a max length (suggested: 2500–4000 characters) to control cost and latency.
- Return friendly error messages on validation failure.

#### Server → Client (Strict JSON)
The server must return **strict JSON** matching the schema below. No extra prose.

```json
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
```

**Schema Rules**
- `change_id` must be unique and stable within a single response (e.g., c1, c2, ...).
- `before` and `after` should be **short, local substrings** (minimal replacement) for accurate highlighting.
- `context_before` / `context_after` should be short (10–30 characters) to disambiguate repeated substrings.
- The changes list must be **exhaustive**: every non-trivial edit must appear in `changes`.
- Spelling fixes must use `type="spelling"` and typically `severity="required"`.
- If a suspected misspelling is not changed due to uncertainty, include an item with `severity="uncertain"`.

### Highlight Rendering (Required)
- Do **not** use `dangerouslySetInnerHTML`.
- Render highlighted revised text as React nodes/spans.
- Each changed substring span must include `data-change-id="<change_id>"` to support hover linking.

### Hover Linking (Required)
- Maintain `activeChangeId` in UI state.
- Bullet item hover sets `activeChangeId`.
- Revised text spans with matching `data-change-id` display additional highlight (background/underline).

---

## 6. Prompting / Model Behavior (Server-Side Requirements)

### Prompt Constraints
The server prompt must enforce:
- Broad Chicago copyediting coverage (including spelling/typos).
- Strict boundaries: no change to meaning/argument/voice; no fact-checking; no creative rewriting.
- Spelling policy: Merriam-Webster default; do not alter proper nouns/foreign terms unless unequivocal; otherwise mark uncertain.

### Reliability Requirements
- The server must parse and validate JSON output.
- If JSON is invalid, the server may retry once, then return a clear error.
- Use low randomness (temperature ~0.0–0.3) to reduce stylistic drift.

---

## 7. Acceptance Criteria (V1)

A build is accepted when:
1) User can paste a paragraph and receive a revised paragraph.
2) The revised paragraph shows edits in red.
3) A bullet list enumerates the edits with reasons.
4) Hovering a bullet item highlights the corresponding location in the revised paragraph.
5) The editor corrects common misspellings and typos per the spelling policy (Merriam-Webster default).
6) No evidence of meaning/argument/voice changes beyond necessary correctness.
7) API keys are protected (server-side only) and the app shows clear loading/error states.

---

## 8. Out of Scope (V1)

- Full document upload (docx/pdf)
- Multi-paragraph batch processing
- User accounts / persistence
- Fact-checking, citation generation, or substantive rewriting
- Plagiarism detection or originality checks
