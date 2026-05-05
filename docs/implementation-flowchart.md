# Implementation Flowchart — Ophelia AI Improvements

All improvements ordered by **dependency chain** and **effort/impact ratio**.
Each phase is fully functional on its own — ship and test before moving to the next.

---

## Master Build Sequence

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
Quick Wins   Core UX    Reliability  Architecture
(1–2 days)  (3–5 days)  (3–5 days)  (1–2 weeks)
    │            │            │            │
    ▼            ▼            ▼            ▼
No deps    Needs Ph.1   Needs Ph.1   Needs Ph.1–3
```

---

## Phase 1 — Quick Wins
> **Goal:** Measurable improvements with minimal risk. Each item is a single-function change.

```
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 1                                                            │
│                                                                     │
│  1A  Prompt Improvements ──────────────────── 1 hour  ✅ DONE       │
│      └─ scroll hint, wait hint, recovery rule, no-hallucinate rule  │
│                                                                     │
│  1B  Goal Clarification Turn ──────────────── 2 hours  ✅ DONE     │
│      └─ pre-analysis Claude call, one question max, TTS ask         │
│                                                                     │
│  1C  Screenshot Compression / Skipping ────── 2 hours  ✅ DONE     │
│      └─ pageKey cache, adaptive JPEG quality 50–75%                 │
│                                                                     │
│  1D  Persona & Language Selection ─────────── 1 hour  ✅ DONE      │
│      └─ navigator.language → Claude, TTS rate in popup              │
└─────────────────────────────────────────────────────────────────────┘
```

### 1A — Prompt Improvements ✅ DONE
**File:** `src/content/assistant.js` → `_callClaude()` system prompt string
**Commit:** `feat: 1A prompt improvements — scroll, wait, recovery, no-hallucinate rules`

Add 4 rules to the existing system prompt:
```
5. If target is likely below fold → include "scroll down" in instruction.
6. If page shows a loading spinner → instruct user to wait.
7. If element cannot be found → {"instruction":"I couldn't find it. Scroll or describe what you see.","element":null,"done":false}
8. Never invent element attributes not present in the DOM list.
```
**Dependency:** None  
**Risk:** None — prompt-only change, no logic touched

---

### 1B — Goal Clarification Turn ✅ DONE
**File:** `src/content/assistant.js` → new `_clarifyGoal(goal)` function, updated `_listenForGoal()`, optional `onEnd` added to `_speak()`
**Commit:** `feat: 1B goal clarification — pre-flight Claude check, TTS question, mic reopen`

```
_startSession(goal)
       │
       ▼
_clarifyGoal(goal)
  → Claude call with lightweight prompt:
    "Is this goal specific? {clear:true} or {clear:false, question:'...'}"
       │
  ┌────┴────┐
clear?      not clear?
  │              │
  ▼              ▼
_analyze()   _speak(question)
             → _listenForGoal()  [mic reopens]
             → _startSession(refinedGoal)
```

**Dependency:** None  
**Risk:** Low — adds one pre-flight Claude call (~$0.001 extra per session)

---

### 1C — Screenshot Compression / Skipping ✅ DONE
**Files:** `src/content/assistant.js` → `_captureScreen()` + 3 state vars | `src/background/background.js` → `quality` param
**Commit:** `feat: 1C screenshot cache + adaptive quality — 50px pageKey, 75/70/50% JPEG`

```
_captureScreen()
       │
       ├── build pageKey = `${href}|${scrollY}`
       │
  ┌────┴────────────────────────┐
same as _lastPageKey?       different?
       │                        │
       ▼                        ▼
return cached base64      capture new screenshot
(no background call)      quality = _stepsSinceNav < 2 ? 50% : 70%
                          _lastPageKey = pageKey
```

**New variable:** `_lastPageKey`, `_lastScreenshot`, `_stepsSinceNav`  
**Dependency:** None  
**Risk:** Low — screenshot quality degrades gracefully

---

### 1D — Persona & Language Selection ✅ DONE
**Files:** `src/content/assistant.js` | `src/popup/popup.html` | `src/popup/popup.js`
**Commit:** `feat: 1D language + TTS rate — navigator.language in prompt, popup slider, chrome.storage.sync`

```
On session start:
  lang = navigator.language  (e.g. "he", "de", "en-US")
  rate = await chrome.storage.sync.get('ttsRate') || 1.0

Inject into system prompt:
  "Respond in language: {lang}"

_speak():
  utt.rate = rate   (from storage)
  utt.lang = lang

Popup slider:
  [Slow ──●────────── Fast]  saves to chrome.storage.sync
```

**Dependency:** None  
**Risk:** None

---

## Phase 2 — Core UX
> **Goal:** Reduce the two most-felt pain points: wrong element selection and response latency.

```
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 2                          (requires Phase 1 complete)       │
│                                                                     │
│  2A  Element Confidence Scoring ───────────── 3 hours  ✅ DONE     │
│      └─ scored _findEl(), threshold 50, fallback message to Claude  │
│                                                                     │
│  2B  Streaming TTS ──────────────────────── 4 hours  ✅ DONE     │
│      └─ SSE stream from Worker, extract instruction field early     │
│                                                                     │
│  2C  Cross-Page Memory ────────────────────── 3 hours              │
│      └─ chrome.storage.session persist, resume prompt on init       │
└─────────────────────────────────────────────────────────────────────┘
```

### 2A — Element Confidence Scoring ✅ DONE
**File:** `src/content/assistant.js` → rewrite `_findEl()`, add retry loop in `_analyze()`
**Commit:** `feat: 2A element confidence scoring — threshold 50, 2-retry feedback loop to Claude`

```
_findEl(descriptor)
       │
       ▼
Score every visible interactive element:
  +100  aria_label exact match
  + 90  aria_label contains descriptor
  + 80  data-testid match
  + 70  text_content exact match
  + 50  text_content contains descriptor
  + 20  element center is in viewport
  + 10  tag matches expected (button/a/input)
  - 30  element hidden or <10px
       │
       ▼
bestScore > 50 ?
  ├── YES → return element
  └── NO  → return null + push message to Claude:
            "Element not found. Rephrase using visible text or aria-label."
```

**Dependency:** 1A (so Claude knows how to handle the "not found" feedback)  
**Risk:** Medium — replaces current two-tier finder; regression test on Facebook, Google

---

### 2B — Streaming TTS ✅ DONE
**Files:** `workers/gemini.js` → SSE pipe | `src/content/assistant.js` → SSE reader + early `_speak()`
**Commit:** `feat: 2B streaming TTS — SSE pipe in worker, early instruction speak in stream reader`

```
_callClaude()
       │
       ▼
fetch(..., {body: JSON.stringify({..., stream: true})})
       │
       ▼
SSE reader loop:
  accumulate raw text
       │
  instruction field closes?
       ├── YES → _speak(instruction) immediately   ◄── TTS starts ~600ms early
       └── NO  → keep accumulating
       │
  full JSON received?
       └── parse element + done flag → _findEl() → highlight
```

**Dependency:** Cloudflare Worker must forward `stream: true` to Anthropic  
**Risk:** Medium — streaming requires SSE parsing; add fallback to non-streaming if SSE fails

---

### 2C — Cross-Page Memory
**File:** `src/content/assistant.js` + `src/content/content.js`

```
After each _analyze():
  chrome.storage.session.set({
    opheliaSession: {goal, messages, stepCount}
  })

On content.js init (page load):
  chrome.storage.session.get('opheliaSession')
       │
  session exists?
       ├── YES → _speak(`Resume "${goal}"?`)
       │         Ctrl+Space = yes, resumes
       │         Any other key / 10s timeout = discard
       └── NO  → normal idle state

On stop():
  chrome.storage.session.remove('opheliaSession')
```

**Dependency:** None (but benefits from 1B — cleaner goal text to resume)  
**Risk:** Low

---

## Phase 3 — Reliability
> **Goal:** Handle edge cases that currently cause silent failures.

```
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 3                          (requires Phase 1 complete)       │
│                                                                     │
│  3A  Proactive Obstacle Detection ─────────── 3 hours              │
│      └─ pre-check Claude call, cookie banners, modals, login walls  │
│                                                                     │
│  3B  Multi-Modal Element Search ───────────── 5 hours              │
│      └─ coordinate fallback, shadow DOM, iframe pierce              │
└─────────────────────────────────────────────────────────────────────┘
```

### 3A — Proactive Obstacle Detection
**File:** `src/content/assistant.js` → new `_checkObstacle(screenshot)` called before `_callClaude()`

```
_analyze()
    │
    ▼
_checkObstacle(screenshot)
    │
    Claude call (lightweight, no DOM needed):
    "Does screenshot show modal/overlay/cookie banner/login wall?
     {obstacle:true, action:'...'} or {obstacle:false}"
    │
    obstacle?
    ├── YES → _speak(action)     e.g. "Close the cookie banner first"
    │         highlight obstacle element
    │         wait for user action
    │         then _analyze() again (normal flow)
    └── NO  → proceed to _callClaude() as normal
```

**Dependency:** 1A (scroll/wait rules already in prompt)  
**Risk:** Adds 1 extra Claude call per step when obstacle found — acceptable cost

---

### 3B — Multi-Modal Element Search
**File:** `src/content/assistant.js` → extend `_findEl()` with 3 extra tiers

```
_findEl(descriptor)
    │
    ▼
Tier 1: OpheliaPlayer.findElement()    (aria-label, testid, text score)
    │
    null?
    ├── NO → return element
    └── YES ▼

Tier 2: Confidence scoring (from 2A)
    │
    score < 50?
    ├── NO → return element
    └── YES ▼

Tier 3: Shadow DOM pierce
    document.querySelectorAll('*')
    → check el.shadowRoot recursively
    → apply confidence scoring inside shadow tree
    │
    null?
    ├── NO → return element
    └── YES ▼

Tier 4: iframe pierce
    Array.from(document.querySelectorAll('iframe'))
    → frame.contentDocument?.querySelector(selector)
    │
    null?
    ├── NO → return element
    └── YES ▼

Tier 5: Coordinate fallback (screenshot crop)
    → send cropped screenshot region to Claude:
      "Point to the element. Reply {x:N, y:N}"
    → document.elementFromPoint(x, y)
```

**Dependency:** 2A (confidence scoring already implemented)  
**Risk:** High — shadow DOM + iframe access can throw security errors; wrap all tiers in try/catch

---

## Phase 4 — Architecture
> **Goal:** Decouple heavy AI logic from the page thread. Enable MCP tool use.

```
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 4                          (requires Phase 1–3 complete)     │
│                                                                     │
│  4A  Service Worker Agent Core ────────────── 3 days               │
│      └─ move _callClaude, _scanPage, _formatElements to SW          │
│                                                                     │
│  4B  MCP Server (Basic Tools) ─────────────── 3 days               │
│      └─ find_element, get_page_state, execute_action tools          │
│                                                                     │
│  4C  Developer Knowledge MCP ──────────────── 2 days               │
│      └─ platform-specific knowledge, best practices, API docs       │
└─────────────────────────────────────────────────────────────────────┘
```

### 4A — Service Worker Agent Core
**Files:**
- `src/background/background.js` → add `analyze` message handler
- `src/content/assistant.js` → replace `_callClaude()` with `sendMessage({action:'analyze', ...})`

```
BEFORE:                           AFTER:
─────────────────────────────     ─────────────────────────────────────
Content Script                    Content Script
  _captureScreen()      ──────►     sendMessage({
  _scanPage()                          action: 'analyze',
  _formatElements()                    screenshot,
  _callClaude()                        domElements,
  parse JSON                           messages,
  _findEl()             ◄──────        goal
  highlight                         })
  TTS                              ◄── {instruction, element, done}
                                   _findEl()
                                   highlight
                                   TTS

                                  Service Worker (background.js)
                                    receive 'analyze'
                                    _scanPage() [via scripting API]
                                    _formatElements()
                                    _callClaude()
                                    return step JSON
```

**Dependency:** All Phase 1–3 features should be migrated first  
**Risk:** High — scripting API for DOM access from SW is limited; `_scanPage` may need to stay in content script and just pass data to SW

---

### 4B — MCP Server (Basic Tools)
**New file:** `workers/mcp-server.js` (Cloudflare Worker)

```
Tool Registry:
┌─────────────────────────────────────────────────────┐
│  find_element(description, page_context)             │
│  → Runs confidence scoring remotely                  │
│  → Returns best-match element descriptor             │
│                                                      │
│  get_page_state()                                    │
│  → Returns structured page summary                  │
│  → URL, title, element list, scroll position         │
│                                                      │
│  execute_action(action, target, value)               │
│  → click / type / scroll / focus                    │
│  → Content script executes, reports result          │
└─────────────────────────────────────────────────────┘

Claude tool-use loop:
  Claude → "I need find_element('Search bar')"
         → MCP server calls back to content script
         → content script returns element
         → Claude uses it in next response
```

---

### 4C — Developer Knowledge MCP
**New file:** `workers/knowledge-mcp.js` (Cloudflare Worker)

```
Knowledge sources:
┌─────────────────────────────────────────────────────┐
│  Platform quirks DB                                  │
│  e.g. "Facebook: nav uses aria-label not text"      │
│  e.g. "Gmail: compose button = div[role=button]"    │
│                                                      │
│  Query: dev_knowledge("how to find search on X")    │
│  → returns platform-specific selector hints         │
│  → injected into Claude system prompt dynamically   │
└─────────────────────────────────────────────────────┘
```

---

## Full Timeline

```
Week 1
  Day 1  │ 1A Prompt improvements + 1D Language selection
  Day 2  │ 1B Goal clarification + 1C Screenshot compression
  Day 3  │ 2A Element confidence scoring
  Day 4  │ 2B Streaming TTS (+ Cloudflare Worker update)
  Day 5  │ 2C Cross-page memory  ──────────  ✅ SHIP v2

Week 2
  Day 1  │ 3A Proactive obstacle detection
  Day 2  │ 3B Multi-modal search (Tier 3: shadow DOM)
  Day 3  │ 3B Multi-modal search (Tier 4–5: iframe + coordinates)
  Day 4  │ Integration testing across Facebook, Google, LinkedIn
  Day 5  │ Bug fixes  ────────────────────── ✅ SHIP v3

Week 3–4
  Days 1–3  │ 4A Service Worker agent core
  Days 4–6  │ 4B MCP basic tools
  Days 7–8  │ 4C Developer Knowledge MCP
  Days 9–10 │ End-to-end testing + migration  ✅ SHIP v4
```

---

## Dependency Graph

```
1A Prompt ──────────────────────────────────────────────────────────► 3A Obstacle
    │
    └──► 1B Clarification ──────────────────────────────────────────► 2C Memory (better resume text)
    │
    └──► 1C Screenshot ─────────────────────────────────────────────► 2B Streaming TTS (cost baseline)
    │
    └──► 1D Language ───────────────────────────────────────────────► (standalone, no dependents)
    │
    └──► 2A Confidence Scoring ─────────────────────────────────────► 3B Multi-Modal Search
              │
              └──► 2B Streaming TTS (parallel, no strict dep)
              │
              └──► All Phase 4 (stable element logic needed first)
```

---

## Files Touched Per Phase

| Phase | Files Modified | New Files |
|---|---|---|
| 1A | `src/content/assistant.js` | — |
| 1B | `src/content/assistant.js` | — |
| 1C | `src/content/assistant.js` | — |
| 1D | `src/content/assistant.js`, `src/popup/popup.html`, `src/popup/popup.js` | — |
| 2A | `src/content/assistant.js` | — |
| 2B | `src/content/assistant.js`, `workers/gemini.js` | — |
| 2C | `src/content/assistant.js`, `src/content/content.js` | — |
| 3A | `src/content/assistant.js` | — |
| 3B | `src/content/assistant.js` | — |
| 4A | `src/content/assistant.js`, `src/background/background.js` | — |
| 4B | — | `workers/mcp-server.js` |
| 4C | — | `workers/knowledge-mcp.js` |
