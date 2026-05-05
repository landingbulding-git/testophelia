# Ophelia — Product Vision & Rebuild Plan

> **Status:** Phases 1–4C implemented. Core AI assistant still unreliable and slow in practice.
> This document diagnoses why, defines what Ophelia must become, and lays out the build plan.

---

## Why Ophelia Fails Today

### 1. The AI is guessing, not knowing

Claude receives a screenshot + a list of 40 DOM elements and invents the next step from scratch on every click. It has no reliable knowledge of how Facebook, Bubble.io, or Zoho CRM actually work. The static `PLATFORM_KB` (4C) is a band-aid — 5 bullet points cannot replace real documentation.

**Result:** Claude confidently hallucinates element targets, especially on complex SPAs, React apps, or tools with non-standard DOM structures.

### 2. Element targeting is heuristic, not deterministic

`_findEl` scores DOM elements based on aria-label fuzzy matches. When the label doesn't exist, or the element is inside a shadow root, or the app renders differently per user — the match fails silently.

**Result:** The orange dot appears on the wrong element or nothing at all. The user clicks the wrong thing. Claude can't recover.

### 3. 4B broke streaming TTS

Switching `_handleAnalyze` to non-streaming tool-use removed the streaming pipeline. Claude now has to complete its FULL response (including any tool rounds) before the first word reaches TTS. This added 3–6 seconds of silence per step.

**Result:** Ophelia feels slower after 4B than before it.

### 4. The rate limiter is too aggressive

`MIN_CALL_GAP_MS = 2000` adds a guaranteed 2s pause before every Claude call. Combined with Claude's latency (~1.5s for Sonnet), each step takes 3.5s minimum. With tool-use, up to 8–10s.

**Result:** Ophelia feels painful to use even when it's working correctly.

### 5. No verification → no error recovery

After Claude says "click the Save button" and the user clicks it, Ophelia immediately calls Claude again without checking if anything happened. If the click was wrong (wrong element, wrong state), Ophelia ploughs on generating a sequence of wrong steps.

**Result:** Errors compound. The session quickly becomes useless.

---

## What Ophelia Must Become

### Product A — AI-Guided Assistant (ask anything, anywhere)

> "Help me set up a Zoho CRM pipeline from scratch" → Ophelia walks the user through it, step by step, on their live browser, without ever getting confused.

Requirements:
- Guides complex multi-step workflows on specialized tools (Bubble.io, Suno, Zoho, Webflow, Notion, etc.)
- Knows the actual interface of these apps — not from a screenshot, but from real documentation
- Responds in under 2 seconds per step
- Recovers when a step fails instead of getting stuck
- Works on the user's own live session (logged-in state, real data)

### Product B — Pre-taught Tutorials (record once, play for everyone)

> Creator records "How to create a campaign in Mailchimp" → 10,000 users play it with 100% accuracy, each step highlighted precisely on their screen.

Requirements:
- One-click recording that captures robust element fingerprints
- YouTube video → tutorial draft (AI extracts steps from transcript)
- Shareable link that works for any user on any account
- Self-healing when site UI changes (multi-signal fallback)
- Overlay card with step number, instruction, and highlighted element

---

## Architecture: How We Get There

### MCP Strategy — Connect to Existing MCPs, Don't Build a Knowledge Database

Bubble.io, Zoho CRM, Notion, Airtable, Suno, and the vast majority of target platforms already publish official MCP servers. **We connect to them. We don't rebuild what they've already built.**

Ophelia's background service worker is the **MCP client**. A single Cloudflare Worker acts as the **MCP Gateway** — it manages auth tokens, handles CORS, and proxies tool calls to each platform's official MCP server. Claude calls `call_platform_tool(tool, input)` and gets back real, up-to-date documentation and capabilities directly from the platform.

No local servers. No Playwright. No manual knowledge database. Works as a pure browser extension.

```
User speaks goal
       │
       ▼
Detect platform from URL → look up MCP registry
       │
       ▼
plan_session (SW → Claude Haiku + platform MCP context)
  generates a plan grounded in real app knowledge
       │
       ▼
Per step: _handleAnalyze (SW → Claude Sonnet, streaming)
  ┌──────────────────────────────────────────────┐
  │  Claude can call:                            │
  │  • call_platform_tool(tool, input)           │ ← MCP Gateway → platform's official MCP
  │  • get_accessibility_tree()                  │ ← content script (ARIA rescan)
  │  • inspect_element(hint)                     │ ← content script (form state)
  │  • think_deeply(goal, context)               │ ← Sequential Thinking MCP (CF Worker)
  └──────────────────────────────────────────────┘
       │
       ▼
Instruction streams to TTS immediately (first word <500ms)
Element found via ARIA/selector → visual fallback only if needed
       │
       ▼
After user clicks: verify DOM changed (Haiku, <200ms)
If not: Claude calls inspect_element → explains why → user unblocked
```

### MCP Registry (in background.js)

```javascript
const MCP_REGISTRY = {
  'bubble.io':       'https://mcp.bubble.io',
  'zoho.com':        'https://mcp.zoho.com',
  'notion.com':      'https://mcp.notion.com',
  'airtable.com':    'https://mcp.airtable.com',
  'suno.com':        'https://mcp.suno.com',
  'webflow.com':     'https://mcp.webflow.com',
  'mailchimp.com':   'https://mcp.mailchimp.com',
  'linear.app':      'https://mcp.linear.app',
  'github.com':      'https://mcp.github.com',
};
```

When a session starts, the platform is detected from `location.href` → the right MCP is selected → Claude has access to official tools for that platform.

---

## Phase 5 — Fix What's Broken (Do This First)

### 5A — Re-enable Streaming TTS

**Problem:** 4B's tool-use loop broke streaming. Claude must finish all tool rounds before TTS gets any text.

**Fix:** Two-path architecture in `_handleAnalyze`:
- **Fast path (default):** streaming call with no tools. Pipe tokens directly to TTS. ~1.5s to first word.
- **Tool path (on demand):** if Claude's text response contains a special marker (e.g. `{{NEEDS_TOOL}}`), or if the page is complex, switch to non-streaming tool-use.

Better approach: stream first, tools second. Make the first call streaming. If the response is a valid JSON step — done. If the response says it's uncertain, THEN do a non-streaming tool-use follow-up.

**Files:** `background.js` (`_handleAnalyze`), `assistant.js` (`_analyze`, `_onStep`)

---

### 5B — Speed: Remove Rate Limit + Use Haiku for Verification

**Remove:** `MIN_CALL_GAP_MS = 2000` entirely. Claude API handles rate limiting server-side.

**Two models:**
- `claude-haiku-4-5` (or `claude-3-haiku-20240307`): plan_session, verify_step, clarifyGoal, checkObstacle — sub-1s responses
- `claude-sonnet-4-5`: _handleAnalyze main call only

**Expected improvement:** from ~4s/step → ~1.5s/step

**Files:** `background.js` (replace model constants, remove rate limit)

---

### 5C — Step Verification (Did It Work?)

After each user click, before calling Claude again, check if the DOM meaningfully changed:

```javascript
async function _verifyStepExecuted(beforeSnapshot, afterSnapshot) {
  // Compare URL, title, key element counts, modal presence
  // If unchanged after 1.5s → step may have failed
  // → Claude gets a "step_failed: true" flag in next analyze call
}
```

**If step failed:** Claude receives `{stepFailed: true, reason: "DOM unchanged after 1.5s"}` → Claude calls `inspect_element` → explains why → user gets actionable message.

**Files:** `assistant.js` (capture DOM snapshot before click in `_watchPage`), `background.js` (flag in analyze message)

---

## Phase 6 — Platform MCP Client (The Intelligence Gap)

### The insight

Bubble.io, Zoho, Notion, Airtable and most target platforms already publish official MCP servers. They contain real, up-to-date documentation, tool schemas, and API capabilities — maintained by the platform teams, not by us.

**We build a universal MCP gateway, not a knowledge database.**

### MCP Gateway Worker

**New file:** `workers/mcp-gateway.js`

```
Responsibilities:
  • Auth management — stores platform OAuth tokens per user
  • MCP proxying — routes tool calls from extension → platform MCP server
  • Response caching — Cloudflare KV, 15min TTL for repeated queries
  • CORS handling — extensions can't call all MCPs directly

Endpoints:
  POST /call  → {platform, tool, input, userToken?}
              → proxies to platform MCP → returns result

  POST /list  → {platform}
              → returns available tools for that platform

  POST /auth  → {platform, code} (OAuth callback)
              → stores token in KV
```

### Tool in `_handleAnalyze`

```javascript
{
  name: 'call_platform_tool',
  description: 'Call an official tool from the current platform\'s MCP server to get real documentation, available options, or platform-specific guidance.',
  input_schema: {
    tool:  { type: 'string', description: 'Tool name from the platform MCP (e.g. "search_docs", "list_templates")' },
    input: { type: 'object', description: 'Tool input parameters' }
  }
}
```

### MCP-first planning

When session starts on a known platform:
1. Gateway fetches available tools from the platform MCP
2. Claude receives tool list with descriptions
3. `plan_session` and `_handleAnalyze` both have access to platform tools
4. Claude calls `call_platform_tool("search_docs", {query: "create workflow"})` → gets real Bubble.io workflow docs
5. No manual knowledge entry needed — ever

### Priority platform MCPs to connect

| Platform | MCP Available | Auth |
|---|---|---|
| **Bubble.io** | Yes | API key |
| **Notion** | Yes (official) | OAuth |
| **Airtable** | Yes (official) | OAuth / API key |
| **Linear** | Yes (official) | OAuth |
| **GitHub** | Yes (official) | OAuth |
| **Zoho CRM** | Yes | OAuth |
| **Webflow** | Yes | OAuth |
| **Suno** | Verify | API key |
| **Mailchimp** | Yes | OAuth |

This replaces the static `PLATFORM_KB` entirely — and updates itself automatically as platforms evolve.

---

## Phase 7 — Tutorial System: 100% Accuracy

### 7A — Robust Recording

Current recorder saves: `{aria_label, data_testid, css_selector, text_content, pos}`

Add:
- `xpath` — absolute XPath as last-resort selector
- `visual_description` — AI-generated visual description (e.g. "blue Save button in top-right toolbar") generated at record time
- `computed_role` / `computed_label` — ARIA computed properties (from 4B)
- `confidence_score` — how reliable each signal is (id > aria-label > testId > text > position)

**At record time:** AI annotates each step:
```json
{
  "step_number": 3,
  "instruction": "Click the Workflow tab in the left sidebar",
  "element": {
    "aria_label": "Workflow",
    "data_testid": null,
    "css_selector": ".editor-sidebar [aria-label='Workflow']",
    "xpath": "//nav[@class='editor-sidebar']//a[text()='Workflow']",
    "visual_description": "Tab labeled 'Workflow' in the left sidebar, below 'Design'",
    "confidence": "high"
  }
}
```

### 7B — Sequential Thinking MCP (as Cloudflare Worker)

**New file:** `workers/thinking-mcp.js`

```
POST /think

Input: {goal, context, platform, currentState}
Output: {reasoning, plan: [...steps], caveats: [...]}

Internally: calls Claude with extended thinking enabled
Cached: same goal+platform → return cached plan (Cloudflare KV, 1hr TTL)
```

Used for: complex goals like "set up a Zoho CRM pipeline" where planning requires deep reasoning before any execution.

Cost: ~$0.015 per planning call. Cached → free for repeat goals.

### 7C — YouTube Video → Tutorial

**New page:** `testophelia.vercel.app/create`

```
1. Creator pastes YouTube URL
2. Worker fetches video transcript (YouTube Data API or yt-dlp)
3. Claude converts transcript to structured step list
4. Creator opens the target site with Ophelia
5. Ophelia enters "validation mode":
   - Reads step 1 from the AI draft
   - Asks creator: "Does this step look right? Click the element for step 1"
   - Creator clicks → element fingerprint captured
   - Repeat for all steps
6. Validated tutorial saved with element fingerprints
7. Shareable link generated
```

This gives us: AI-drafted steps (fast) + human-validated element targets (accurate) = 100% accuracy tutorials.

**Transcript extraction:**
- Option A: YouTube Data API (requires API key, captions only)
- Option B: Cloudflare Worker calls `youtube-transcript-api` (npm) via Node.js compatibility
- Option C: User pastes the transcript manually (simplest for v1)

---

## Phase 8 — Creator Portal & Marketplace

**`testophelia.vercel.app`** evolves from a landing page to a full creator portal:

```
/create          — YouTube URL → tutorial draft + validation flow
/tutorials       — Browse published tutorials by platform
/tutorial?id=X   — Tutorial player (existing)
/dashboard       — Creator analytics (views, completion rate)
```

**Tutorial quality signals:**
- Completion rate (did users reach the last step?)
- Step failure rate per step (which steps fail most often?)
- User corrections (automatically improves the tutorial over time)

---

## Immediate Priorities (Next 5 Sessions)

```
Session 1  │ 5A: Re-enable streaming TTS in _handleAnalyze
           │ 5B: Remove rate limit, add claude-haiku for fast calls

Session 2  │ 5C: Step verification (DOM snapshot before/after click)
           │     + "step failed" recovery flow

Session 3  │ 6A: knowledge-mcp.js Cloudflare Worker skeleton
           │     + Vectorize database setup
           │     + search_knowledge tool in _handleAnalyze

Session 4  │ 6B: Ingest documentation for Bubble.io + Zoho CRM
           │     Test: "help me create a workflow in Bubble"

Session 5  │ 7A: Enhanced recorder (xpath + visual_description + confidence)
           │ 7B: thinking-mcp.js for complex planning
```

---

## MCP Summary Table

| MCP | Type | Where | Solves |
|---|---|---|---|
| **Platform MCP Gateway** | CF Worker → official platform MCPs | Remote | AI doesn't know the app |
| **Sequential Thinking MCP** | Cloudflare Worker | Remote | Complex multi-step planning |
| **get_accessibility_tree** | Native (content script) | Local | Incomplete DOM list |
| **inspect_element** | Native (content script) | Local | Disabled/blocked elements |
| **plan_session** | Native (SW → Claude Haiku) | Local | Per-goal step coherence |
| **verify_step** | Native (SW → Claude Haiku) | Local | Did the action work? |

No local Node.js servers. No Playwright controlling a separate browser. Everything either native to the extension or a Cloudflare Worker. The user's real logged-in session is always used.

---

## Cost Model (per 10-step session)

| Today (4B) | After Phase 5–6 |
|---|---|
| plan_session: $0.008 (Sonnet) | plan_session: $0.001 (Haiku) |
| 10× analyze: $0.060 (Sonnet, non-streaming) | 10× analyze: $0.040 (Sonnet, streaming) |
| Rate limit overhead: +5-10s silence | Rate limit: removed |
| **Total: ~$0.068, ~5s/step** | Platform MCP calls: $0 (platform-provided) |
| | **Total: ~$0.041, ~1.2s/step** |

**40% cost reduction, 4× speed improvement** from phases 5–6 alone.

Complex app session (Bubble.io, 20 steps):
- Without platform MCP: high failure rate → useless
- With platform MCP: ~$0.082 total + $0.015 thinking call = ~$0.097 per session, ~95% accuracy
- Platform MCP tool calls: free (or included in platform subscription)

---

## Key Design Principles

1. **Knowledge first, DOM scanning second.** Claude should know the app before looking at any screenshot.
2. **Stream everything.** First word to TTS in <500ms. Never make the user wait in silence.
3. **Fail loudly, recover fast.** If a step fails, say why and how to fix it. Never silently move on.
4. **Deterministic where possible, AI where necessary.** ARIA selectors > heuristics > screenshot. AI is the last resort, not the first.
5. **Connect, don't build.** Every platform that has an official MCP — use it. Build our own only for what doesn't exist.
6. **MCPs as remote knowledge, not remote control.** We don't hand off execution to an external tool. We give Claude better information to make better decisions — execution always stays in the extension.
