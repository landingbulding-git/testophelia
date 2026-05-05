# Ophelia — Implementation Plan

> For product strategy and architecture, see `docs/product-vision.md`.
> This file is the **implementation checklist** — what to build, in what order, with what files.

---

## Completed (Phases 1–4C)

| Phase | What | Status |
|---|---|---|
| 1A | Prompt improvements (scroll, wait, fail-open rules) | ✅ |
| 1B | Goal clarification turn (`_clarifyGoal`) | ✅ |
| 1C | Screenshot compression + caching | ✅ |
| 1D | Language / TTS rate selection | ✅ |
| 2A | Element confidence scoring (`_findEl` rewrite) | ✅ |
| 2B | Streaming TTS (SSE pipe → speak on first token) | ✅ |
| 2C | Cross-page memory (`chrome.storage.session` resume) | ✅ |
| 3A | Proactive obstacle detection (`_checkObstacle`) | ✅ |
| 3B | Multi-modal element search (shadow DOM, iframe, coord fallback) | ✅ |
| 4A | Service Worker agent core (all Claude calls in SW) | ✅ |
| 4B | Native tool-use: `get_accessibility_tree`, `plan_session`, `inspect_element` | ✅ |
| 4C | Platform knowledge base (`PLATFORM_KB` static hints) | ✅ |

---

## Phase 5 — Core Fixes ⚡ Do First

### 5A — Re-enable Streaming TTS

**Problem:** 4B switched `_handleAnalyze` to non-streaming tool-use. Streaming broke. User now waits in silence for all tool rounds to complete before hearing anything.

**Fix:** Two-path `_handleAnalyze`:
- **Default (fast path):** streaming call, no `tools` parameter. Pipe SSE tokens to TTS directly. If Claude responds with valid JSON step → done. Target: first word in <500ms.
- **Tool path (fallback):** if fast path response is uncertain (Claude says it needs more info), do a second non-streaming tool-use call. This is the exception, not the rule.

**Files:** `src/background/background.js` (`_handleAnalyze`), `workers/gemini.js` (verify tool-use passthrough)

**Success:** Open SW DevTools → start session → hear TTS within 1.5s of session start

---

### 5B — Remove Rate Limit + Use Haiku for Cheap Calls

**Problem:** `MIN_CALL_GAP_MS = 2000` adds 2s of silence before every Claude call, even when Claude responded in 200ms.

**Changes:**
- Remove `MIN_CALL_GAP_MS` and `_swLastCallAt` entirely from `background.js`
- Add `CLAUDE_HAIKU = 'claude-haiku-4-5'` constant
- Switch to Haiku for: `_handlePlanSession`, `_handleCheckObstacle`, `_handleClarifyGoal`
- Keep Sonnet only for `_handleAnalyze` main call

**Files:** `src/background/background.js`

**Expected:** ~4s/step → ~1.5s/step. Cost per session: ~40% reduction.

---

### 5C — Step Verification

**Problem:** Ophelia has no idea if the user's click actually did anything. If they clicked the wrong element, the next step is built on a broken state.

**Implementation:**
1. Content script captures a lightweight DOM snapshot before each user click: `{url, title, elementCount, hasModal}`
2. 1.5s after click, capture again
3. If unchanged → send `{stepFailed: true}` flag in the next `analyze` message
4. Claude receives this flag → calls `inspect_element` → explains why it failed

**New function in `assistant.js`:** `_domSnapshot()` — returns `{url, elementCount, hasModal, scrollY}`

**Files:** `src/content/assistant.js` (`_watchPage`, new `_domSnapshot`), `src/background/background.js` (pass `stepFailed` in analyze body)

---

## Phase 6 — Platform MCP Client 🧠 The Intelligence Gap

> Full rationale in `docs/product-vision.md` Phase 6.

**Core insight:** Bubble.io, Notion, Airtable, Zoho, Webflow, Linear, GitHub and most target platforms already have official MCP servers. We connect to them — we don't build a knowledge database.

### 6A — MCP Gateway Worker

**New file:** `workers/mcp-gateway.js`

```
POST /call   {platform, tool, input}  → proxies to platform MCP, returns result
POST /list   {platform}               → returns available tools list
POST /auth   {platform, code}         → OAuth callback, stores token in KV
```

- Uses Cloudflare KV for token storage and response caching (15min TTL)
- Handles CORS (extensions can't call all MCP servers directly)
- Returns error gracefully if platform has no MCP registered

**Also add to `background.js`:**
```javascript
const MCP_REGISTRY = {
  'bubble.io':    'https://mcp.bubble.io',
  'notion.com':   'https://mcp.notion.com',
  'airtable.com': 'https://mcp.airtable.com',
  'linear.app':   'https://mcp.linear.app',
  'github.com':   'https://mcp.github.com',
  'zoho.com':     'https://mcp.zoho.com',
  'webflow.com':  'https://mcp.webflow.com',
  'mailchimp.com':'https://mcp.mailchimp.com',
};
```

---

### 6B — `call_platform_tool` in `_handleAnalyze`

Replace static `PLATFORM_KB` hints with a live tool Claude can call:

```javascript
{
  name: 'call_platform_tool',
  description: 'Call an official tool on the current platform\'s MCP server. Use this to get real documentation, available options, or step-by-step guidance specific to this platform.',
  input_schema: {
    type: 'object',
    properties: {
      tool:  { type: 'string' },
      input: { type: 'object' }
    },
    required: ['tool', 'input']
  }
}
```

SW executes: `fetch(MCP_GATEWAY + '/call', {platform, tool, input})` → returns result to Claude.

**Files:** `src/background/background.js`, `workers/mcp-gateway.js`

---

### 6C — MCP-first Planning

Update `_handlePlanSession` to first fetch available tools from the platform MCP, then pass them to Haiku as context before generating the plan.

```javascript
// In _handlePlanSession:
const platformTools = await fetchPlatformTools(pageUrl); // calls gateway /list
// Include in Haiku prompt: "The platform provides these tools: [list]"
```

**Success criteria:** Start a session on bubble.io → Claude's plan references Bubble-specific terminology and UI patterns correctly → first step is accurate

---

## Phase 7 — Tutorial System: 100% Accuracy

### 7A — Robust Recording

Add to each recorded step element in `recorder.js`:
- `xpath` — absolute XPath (last-resort selector)
- `visual_description` — AI-generated on stop: "blue Save button in top-right toolbar"
- `computed_role` + `computed_label` — from ARIA APIs
- `confidence` — `high` (id/aria-label) | `medium` (testId/text) | `low` (position only)

**Post-recording AI annotation** (called in `recorder.js` `stop()`):
```javascript
// Send steps to SW → Claude Haiku annotates each with visual_description + confidence
// Returns enriched steps → saved to Firebase
```

**Files:** `src/content/recorder.js`, `src/background/background.js` (new `_handleAnnotateSteps`)

---

### 7B — Sequential Thinking MCP

**New file:** `workers/thinking-mcp.js`

```
POST /think
Input:  {goal, platform, context, currentState}
Output: {reasoning, plan: [...steps], caveats: [...]}
```

- Calls Claude Sonnet with extended thinking (`thinking: {type: "enabled", budget_tokens: 5000}`)
- Caches result in KV by `hash(goal + platform)`, 1hr TTL → repeat calls are free
- Used for goals that require upfront reasoning: "set up a Zoho CRM pipeline", "build a Bubble app with user auth"

**Integration:** `_handlePlanSession` checks if goal is "complex" (> 8 words or contains platform-specific keywords) → calls thinking MCP before generating step list

**Files:** `workers/thinking-mcp.js`, `src/background/background.js`

---

### 7C — YouTube → Tutorial

**New page:** `testophelia.vercel.app/create`

Flow:
1. Creator pastes YouTube URL
2. Cloudflare Worker fetches transcript (YouTube Data API)
3. Claude converts transcript → structured step list `[{step, expected_action}]`
4. Creator opens target site with Ophelia in "validation mode"
5. Ophelia reads each draft step, asks creator to click the correct element
6. Each click captures element fingerprint → saves validated step
7. Tutorial stored in Firebase → shareable link generated

**Files:** `web/create.html` (new), `workers/youtube-mcp.js` (new), `src/background/background.js` (validation mode handler)

---

## Phase 8 — Creator Portal

**`testophelia.vercel.app` pages:**

| Page | Purpose |
|---|---|
| `/create` | YouTube URL → tutorial draft + validation flow |
| `/tutorials` | Browse published tutorials by platform tag |
| `/tutorial?id=X` | Tutorial player (already exists) |
| `/dashboard` | Creator: views, completion rate, step failure heatmap |

**Quality signals stored per tutorial:**
- `completionRate` — % of users who finished
- `stepFailRate[n]` — % of users who failed on step n
- `corrections[n]` — most common user correction for step n (auto-improves future recordings)

---

## Tools Reference

| Tool | Type | Model | Latency | Cost |
|---|---|---|---|---|
| `plan_session` | Native SW | Haiku | ~0.5s | ~$0.001 |
| `_handleAnalyze` fast path | Native SW, streaming | Sonnet | ~1.2s | ~$0.004 |
| `_handleAnalyze` tool path | Native SW, non-streaming | Sonnet | ~3s | ~$0.008 |
| `get_accessibility_tree` | Content script | — | ~50ms | $0 |
| `inspect_element` | Content script | — | ~30ms | $0 |
| `call_platform_tool` | CF Worker → platform MCP | — | ~200ms | $0 |
| `think_deeply` | CF Worker (thinking MCP) | Sonnet extended | ~4s | ~$0.015 |
| `verify_step` | Native SW | Haiku | ~300ms | ~$0.0002 |
