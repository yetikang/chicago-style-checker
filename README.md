# Chicago Style Checker

A web-based copyediting tool that applies the **Chicago Manual of Style (CMoS)** to your writing. Paste a paragraph, and get instant, AI-powered corrections with detailed explanations.

![CMoS 17th Edition](https://img.shields.io/badge/CMoS-17th_Edition-8B0000)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

---

## Features

- **Instant Corrections** — Submit a paragraph and receive Chicago-style edits in seconds
- **Visual Diff Highlights** — See exactly what changed with inline strikethrough and color-coded corrections
- **Detailed Explanations** — Each edit includes the rule category, before/after text, and reasoning
- **Hover-to-Locate** — Hover over any change in the list to highlight its position in the revised text
- **One-Click Copy** — Easily copy the corrected text to your clipboard

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- An LLM API key (Gemini or Groq)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd chicago-style-checker

# Install dependencies
npm install

# Configure environment variables
cp .env.local.example .env.local
```

### Configuration

Edit `.env.local` with your settings:

```bash
# Required: LLM Provider API Key
GEMINI_API_KEY=your-gemini-api-key    # Required if using Gemini (default)
# GROQ_API_KEY=your-groq-api-key      # Required if using Groq

# Optional: LLM Provider Selection
# LLM_PROVIDER=gemini                 # Options: gemini | groq (default: gemini)

# Optional: Password Protection
# SITE_PASSWORD=your-password         # Enables site-wide password gate
# DISABLE_PASSWORD_GATE=1             # Disables password for local dev

# Optional: Development Mode
# USE_MOCK=1                          # Use mock responses (no API calls)
```

### Run the Application

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

Open [http://localhost:3000](http://localhost:3000) to start editing.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI Backend | Google Gemini / Groq |
| Rate Limiting | Upstash Redis |

---

## API Reference

### `POST /api/rewrite`

Applies Chicago Manual of Style corrections to the provided text.

**Request:**
```json
{
  "text": "Your paragraph here (max 4000 characters)"
}
```

**Response:**
```json
{
  "revised_text": "Corrected paragraph",
  "changes": [
    {
      "change_id": "c1",
      "type": "spelling|grammar|punctuation|...",
      "before": "original",
      "after": "corrected",
      "reason": "Explanation of the change",
      "severity": "required|recommended|optional"
    }
  ]
}
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes* | Google Gemini API key |
| `GROQ_API_KEY` | Yes* | Groq API key (if using Groq) |
| `LLM_PROVIDER` | No | `gemini` or `groq` (default: `gemini`) |
| `GEMINI_MODEL` | No | Gemini model name (default: `gemini-2.0-flash-exp`) |
| `GROQ_MODEL` | No | Groq model name |
| `SITE_PASSWORD` | No | Enables password protection |
| `DISABLE_PASSWORD_GATE` | No | Set to `1` to disable password gate |
| `USE_MOCK` | No | Set to `1` for mock mode (no API calls) |
| `MAINTENANCE_MODE` | No | Set to `1` to disable the service |
| `RATE_GLOBAL_RPM` | No | Global rate limit per minute (default: `9`) |
| `RATE_USER_30S` | No | Per-user rate limit per 30s (default: `1`) |
| `RATE_USER_RPD` | No | Per-user daily limit (default: `20`) |
| `UPSTASH_REDIS_REST_URL` | No | Upstash Redis URL for rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | No | Upstash Redis token |

*One of `GEMINI_API_KEY` or `GROQ_API_KEY` is required unless `USE_MOCK=1`.

---

## License

Private project. All rights reserved.
