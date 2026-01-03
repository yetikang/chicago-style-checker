# Chicago Style Checker

A minimalist, academic-style web utility that performs Chicago Manual of Style (CMoS)–informed paragraph-level copyediting.

## Features

- **Paragraph-level editing**: Paste a paragraph and receive Chicago-style corrections
- **Visual highlights**: See all edits highlighted in red
- **Detailed change list**: Each edit includes an explanation and reason
- **Hover-to-locate**: Hover over change items to highlight corresponding text in the revised output
- **MOCK and REAL modes**: Test with deterministic mock responses or use Gemini for real editing

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Create a `.env.local` file in the root directory:

```bash
# For MOCK mode (no API key needed)
USE_MOCK=1

# For REAL mode (requires Gemini API key)
# USE_MOCK=0
# GEMINI_API_KEY=your-api-key-here
```

### Running the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Building for Production

```bash
npm run build
npm start
```

## Authentication

This site is protected by a simple password gate.

### Configuration
1.  **Set the Password**: Add `SITE_PASSWORD` to your environment variables.
2.  **Disable Gate**: Set `DISABLE_PASSWORD_GATE=1` to bypass authentication.

### How it Works
- Unauthenticated users are redirected to `/unlock`.
- Entering the correct password sets a `cms_auth` cookie (30-day expiry).
- API routes (except `/api/rewrite`) are public. `/api/rewrite` is protected.

## Environment Variables

### `USE_MOCK`

- **Value**: `"1"` for mock mode, any other value or unset for real mode
- **Default**: Unset (real mode)
- **Description**: When set to `"1"`, the API uses deterministic mock responses instead of calling Gemini. This is useful for:
  - Development and testing without API costs
  - UI testing and demos
  - Offline development

**Mock mode corrections:**
- `teh` → `the` (spelling)
- `recieve` → `receive` (spelling)
- `occured` → `occurred` (spelling)
- Multiple consecutive spaces → single space (punctuation/spacing)

### `GEMINI_API_KEY`

- **Required**: Only when `USE_MOCK` is not `"1"`
- **Description**: Your Google Gemini API key for real editing mode
- **How to get**: Sign up at [Google AI Studio](https://aistudio.google.com/) and create an API key
- **Alternative**: You can also use `GOOGLE_API_KEY` (the SDK accepts both)

### `GEMINI_MODEL` (Optional)

- **Default**: `gemini-2.0-flash-exp`
- **Description**: The Gemini model to use for editing
- **Examples**: `gemini-2.0-flash-exp`, `gemini-1.5-pro`, `gemini-1.5-flash`

## API Endpoint

### `POST /api/rewrite`

Edits a paragraph according to Chicago Manual of Style guidelines.

#### Request

```json
{
  "text": "string"
}
```

**Validation:**
- `text` must be a non-empty string
- Maximum length: 4000 characters
- Returns HTTP 400 on validation errors

#### Response

**Success (HTTP 200):**
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

**Error (non-200):**
```json
{
  "error": {
    "type": "validation|timeout|auth|rate_limit|upstream_error|not_configured|internal_error|bad_model_output",
    "message": "string"
  }
}
```

#### Testing Mock Error Mode

To test error handling in mock mode, append `?mockError=1` to the API URL:

```bash
curl -X POST http://localhost:3000/api/rewrite?mockError=1 \
  -H "Content-Type: application/json" \
  -d '{"text": "test"}'
```

This returns HTTP 504 with a timeout error for UI testing.

## Manual Testing Plan

### 1. Mock Mode - Success

1. Set `USE_MOCK=1` in `.env.local`
2. Start the dev server: `npm run dev`
3. Open the app in browser
4. Enter text containing: "teh recieve occured  with  double  spaces"
5. Click "Apply Chicago Style"
6. **Expected**: Revised text with corrections, 3-4 changes listed

### 2. Mock Mode - Error (504)

1. Set `USE_MOCK=1` in `.env.local`
2. Start the dev server
3. Open browser DevTools → Network tab
4. Enter any text and click "Apply Chicago Style"
5. Before request completes, modify the request URL to add `?mockError=1`
   - Or use curl: `curl -X POST http://localhost:3000/api/rewrite?mockError=1 -H "Content-Type: application/json" -d '{"text":"test"}'`
6. **Expected**: HTTP 504 response, error message displayed in UI

### 3. Real Mode - Missing API Key

1. Remove or comment out `GEMINI_API_KEY` in `.env.local`
2. Remove or set `USE_MOCK=0` in `.env.local`
3. Restart dev server
4. Enter text and click "Apply Chicago Style"
5. **Expected**: HTTP 500 error with "not_configured" type, error message in UI

### 4. Real Mode - Timeout

1. Set `USE_MOCK=0` and `GEMINI_API_KEY=invalid-key` (or use a valid key)
2. The API has a 90-second timeout configured
3. Enter text and click "Apply Chicago Style"
4. **Expected**: HTTP 504 timeout error after 90 seconds if the request takes too long

### 5. Validation Errors

1. Leave textarea empty, click "Apply Chicago Style"
2. **Expected**: Client-side validation error

3. Enter text > 4000 characters, click "Apply Chicago Style"
4. **Expected**: HTTP 400 validation error from API

## Project Structure

```
.
├── app/
│   ├── api/
│   │   └── rewrite/
│   │       └── route.ts          # API endpoint (MOCK/REAL modes)
│   ├── globals.css                # Global styles
│   ├── layout.tsx                 # Root layout
│   └── page.tsx                   # Main UI component
├── types.ts                       # TypeScript type definitions
├── tailwind.config.js             # Tailwind configuration
├── next.config.js                  # Next.js configuration
├── package.json                    # Dependencies
└── README.md                       # This file
```

## Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **AI**: Google Gemini API (gemini-2.0-flash-exp by default)

## License

Private project.


