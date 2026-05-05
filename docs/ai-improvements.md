# AI Flow Suggestions & Improvements

## Priority Matrix

| Improvement | Impact | Effort | Priority |
|---|---|---|---|
| Goal clarification turn | High | Low | ★★★ |
| Streaming TTS | High | Medium | ★★★ |
| Element confidence scoring | High | Medium | ★★★ |
| Screenshot compression / skipping | Medium | Low | ★★ |
| Proactive obstacle detection | High | High | ★★ |
| Cross-page memory | Medium | Medium | ★★ |
| Multi-modal element search | High | High | ★★ |
| Persona / language selection | Medium | Low | ★ |

---

## 1. Goal Clarification Turn (Quick Win) ✅ IMPLEMENTED

> `_clarifyGoal()` added to `src/content/assistant.js`. `_listenForGoal()` now calls it before `_startSession()`. `_speak()` gained optional `onEnd` callback so mic reopens only after TTS finishes the question.

**Problem:** Users often state vague goals ("help me with Facebook") and Claude makes assumptions.

**Current behaviour:** Agent immediately starts analyzing and may give wrong first step.

**Proposed flow:**
```
User: "help me with my account"
Ophelia (TTS): "What specifically do you want to do? For example: change
                your password, update your profile picture, or something else?"
User: "change my profile picture"
Ophelia: → starts analyzing
```

**Implementation:**
- Add a pre-analysis turn where Claude assesses goal clarity
- Simplified system prompt for this turn: `"Is this goal specific enough to guide step by step?
  If yes, reply {"clear":true}. If not, reply {"clear":false,"question":"..."}"`
- Only one clarification question max — don't interrogate the user

---

## 2. Streaming TTS (Reduce Perceived Latency) ✅ IMPLEMENTED

> `workers/gemini.js` now pipes Anthropic SSE body directly when `stream:true`. `_callClaude()` rewritten as SSE reader — fires `_speak(instruction)` the moment the instruction field closes in the stream. `_analyze()` skips its own `_speak()` via `_instructionSpoken` flag.

**Problem:** User must wait for the full Claude response before hearing anything (~1–2 seconds silent wait).

**Current:** Full response → parse JSON → speak.

**Proposed:** Stream Claude's response, extract `instruction` field as soon as it closes, start TTS immediately while the rest parses.

```js
// Pseudo-code
const stream = await fetch(CLAUDE_WORKER, { ..., body: JSON.stringify({ stream: true }) });
for await (const chunk of stream) {
  if (instructionComplete(chunk)) speakImmediately(instruction);
}
```

**Benefit:** Cuts perceived latency by ~40–60%. User hears guidance before the element is even highlighted.

---

## 3. Element Confidence Scoring ✅ IMPLEMENTED

> `_findEl()` fully rewritten in `src/content/assistant.js` with scored matching (threshold 50). `_analyze()` gained a 2-retry feedback loop: when `_findEl()` returns null and Claude described an element, the failure is pushed back into conversation history and Claude re-examines silently.

**Problem:** When `_findEl()` falls back to text-content substring matching, it can pick the wrong element (e.g., "Save" matches a "Save Draft" button instead of "Save Post").

**Proposed scoring system:**

```
Score = 100  if aria_label exact match
Score = 90   if aria_label contains the target
Score = 80   if data-testid match
Score = 70   if text_content exact match
Score = 50   if text_content contains target
Score += 20  if element is in viewport center
Score += 10  if element tag matches expected (button vs a)
Score -= 30  if element is hidden or very small
```

Pick the highest scorer above threshold 50. If no element scores >50, skip highlight and tell Claude "element not found, describe it differently".

---

## 4. Screenshot Compression / Skipping (Cost Reduction) ✅ IMPLEMENTED

> `_captureScreen()` rewritten in `src/content/assistant.js` with `pageKey` cache (50px scroll buckets) and adaptive quality. `src/background/background.js` now accepts `quality` param (default 70).

**Problem:** Every step sends a ~1,200–2,000 token screenshot even when the page hasn't changed.

**Proposed optimisations:**

### Skip screenshot on same-URL same-scroll position
```js
const pageKey = `${location.href}|${window.scrollY}`;
if (pageKey === _lastPageKey) screenshot = null; // reuse previous
```

### Reduce JPEG quality adaptively
- Default: 70% quality
- If previous 2 steps had no navigation: drop to 50%
- On URL change: bump back to 75%

**Savings:** Could cut image token cost by 30–50% on single-page apps where the URL doesn't change.

---

## 5. Proactive Obstacle Detection ✅ IMPLEMENTED

> `_checkObstacle(screenshot)` added to `src/content/assistant.js`. Runs a lightweight Claude call (`max_tokens: 60`, no DOM) before `_callClaude()` on session start and after every URL change (`_checkObstacleNext` flag). If obstacle detected, speaks the action and waits for user to dismiss before continuing.

**Problem:** Claude sometimes gives a step for an element that's behind a modal, login wall, or cookie banner.

**Proposed:** Before the main analysis, include a quick "obstacle check" pass:

```
System: "Does the screenshot show any modal, overlay, cookie banner, or
         login prompt that would block the user's goal? If yes:
         {"obstacle": true, "action": "close the cookie banner first"}
         If no: {"obstacle": false}"
```

This adds one small Claude call but prevents Claude from giving impossible steps.

---

## 6. Cross-Page Memory ✅ IMPLEMENTED

> `_analyze()` saves `{goal, stepCount}` to `chrome.storage.session` after each step. `checkResume()` reads it on page load and speaks a resume prompt. `Ctrl+Space` within 10s confirms resume; timeout discards it. `stop()` clears the session. `content.js` calls `checkResume()` 800ms after init. (Session Persistence)

**Problem:** When the user navigates to a new page, `_messages` history is preserved in memory but lost on hard refresh or tab close.

**Proposed:**
- Serialize `{_goal, _messages, _stepCount}` to `chrome.storage.session` after each step
- On `content.js` init, check for a pending session and offer to resume (one TTS prompt: "Resume your task: [goal]?")
- Clear session storage on explicit `stop()`

**Benefit:** User can follow Ophelia's instructions across browser restarts or accidental refreshes.

---

## 7. Multi-Modal Element Search ✅ IMPLEMENTED

> `_findEl()` rewritten as `async function _findEl(d, screenshot)` with 5 tiers: T1 main doc scoring, T3 shadow DOM pierce, T4 iframe pierce, T5 Claude coordinate fallback (`max_tokens:30`, `{x,y}` → `elementFromPoint` with DPR scaling). Call site updated to `await _findEl(step.element, screenshot)`.

**Problem:** Sometimes Claude returns an element that exists but is in a shadow DOM, inside an iframe, or rendered via canvas — none of which `_findEl()` can reach.

**Proposed:**
- After `_findEl()` fails, send Claude a **cropped screenshot** of the area where the element should be (based on Claude's described position) and ask: "Point to the element in this image using coordinates"
- Use those coordinates to `document.elementFromPoint(x, y)` as a last-resort finder
- For iframes: try `frame.contentDocument.querySelector(...)` with the same selector

---

## 8. Persona / Language Selection ✅ IMPLEMENTED

> `navigator.language` injected into system prompt in `_callClaude()`. `_speak()` uses `_ttsRate` (loaded from `chrome.storage.sync` on session start) and `utt.lang`. Popup gained a Voice Speed slider that persists via `chrome.storage.sync`.

**Problem:** All instructions are in English, rate/pitch fixed.

**Proposed:**
- Detect browser language (`navigator.language`) and pass it to Claude: `"Respond in {lang}"`
- Expose a simple TTS rate slider in the popup (slow / normal / fast)
- Store preference in `chrome.storage.sync` so it persists across devices

---

## Prompt Improvements ✅ IMPLEMENTED

> Rules 5–8 added to `_callClaude()` system prompt in `src/content/assistant.js`.

### Current system prompt weaknesses
1. **No recovery instruction** — when Claude can't find an element, it often hallucinates a different one instead of admitting failure
2. **No scroll instruction** — Claude never tells the user to scroll, even when the target is just below the fold
3. **No "wait" instruction** — Claude can't express "wait for the page to load"

### Proposed additions to system prompt

```
ADDITIONAL RULES:
5. If an element is likely below the fold, include "scroll down to find" in the instruction.
6. If the page appears to be loading (spinner visible), instruct the user to wait.
7. If you cannot identify the exact element, say so: {"instruction":"I couldn't
   find that element. Try scrolling or describe what you see.", "element":null, "done":false}
8. Never invent element attributes not present in the DOM list.
```

---

## Architectural Improvement: Separate Agent Worker ✅ IMPLEMENTED (4A)

> All Claude calls (`_callClaude`, `_checkObstacle`, `_clarifyGoal`, coord lookup) moved to `background.js` SW. Content script now only owns DOM access, highlighting, and TTS.

---

## 4B — Native Tool-Use Architecture (MCP Design Decision)

> **Decision:** No external MCP servers. All tools implemented natively inside the extension using Claude's built-in tool-use API + existing Chrome extension capabilities.

### Why not external MCP servers?

Full analysis in `docs/mcp-discuss.md`. Short version:

| Proposed Server | Problem |
|---|---|
| **WebMCP** | Requires third-party pages to opt in — they won't |
| **Playwright MCP** | Controls a separate browser; can't see the user's real logged-in session |
| **Sequential Thinking MCP** | Requires local Node.js server — breaks "just install the extension" UX |
| **Chrome DevTools MCP** | Right idea — but `chrome.debugger` API already gives us full CDP access natively |

### What 4B Actually Builds: 3 Native Tools

Rather than routing Claude through an external MCP server, 4B switches `_handleAnalyze` to use **Claude's native tool-use API** (`tools` parameter). Claude decides which tools to call; the SW executes them and feeds results back in a loop.

---

#### Tool 1 — `get_accessibility_tree` ⭐ Highest Priority

**Replaces:** Screenshot-based element scanning (`_scanPage()` + screenshot for element finding)

**How:** Content script enriches each element with native ARIA APIs:
```js
element.computedRole       // true semantic role (e.g. "button" even on a <div>)
element.computedLabel      // accessible name Claude should use
element.ariaExpanded       // is a dropdown open?
element.ariaDisabled       // is it non-interactive?
element.ariaRequired       // is a field mandatory?
```

**Impact:**
- Element accuracy: from ~70% (heuristic scoring) → ~95% (true ARIA labels)
- Token cost: screenshot ~1,200 tokens → ARIA tree ~300 tokens = **~75% cost reduction per step**
- No `chrome.debugger` bar — all ARIA properties are available to content scripts natively

---

#### Tool 2 — `plan_session` ⭐ Highest Priority (cost reduction)

**Replaces:** Full re-analysis from scratch on every step

**How:** Single Claude call at session start generates an ordered step plan:
```
Goal: "change my profile picture on Facebook"
Plan:
  1. Click the profile picture in the top-left
  2. Select "Update profile picture"
  3. Choose "Upload photo"
  4. Select the image from your computer
  5. Click "Save"
```

Subsequent steps: Claude only receives `{currentStep, screenshot}` and answers `{done: true/false}` — not a full re-analysis. Advance pointer on `done: true`.

**Impact:**
- Planning call: ~$0.008 (one time)
- Per-step verification: ~$0.001 (vs ~$0.006 currently)
- 10-step session: **$0.018 vs $0.060 — 70% cost reduction**
- Steps are more coherent (no hallucinated detours mid-session)

---

#### Tool 3 — `inspect_element` (CDP via chrome.debugger)

**Used when:** `_findEl()` succeeds but the element appears disabled or non-interactive

**How:** SW attaches `chrome.debugger` to the tab, runs `DOM.getAttributes` + `CSS.getComputedStyleForNode`, detaches immediately. Claude receives the full computed state.

**Example output to Claude:**
```json
{
  "disabled": true,
  "aria-disabled": "true",
  "reason": "parent form has 2 empty required fields: [name='email'], [name='phone']"
}
```

**Impact:** Claude can explain *why* a step is blocked and tell the user what prerequisite to complete. Eliminates the "click this button" → button doesn't respond → silence failure mode.

**Note:** Attaches `chrome.debugger` only on demand (< 200ms), then detaches. The "Chrome is being debugged" bar appears only briefly.

---

### Tool-Use Flow (replaces current one-shot JSON response)

```
_handleAnalyze()
    │
    ▼
Claude receives: screenshot + ARIA tree + current plan step
    │
    Claude decides:
    ├── No tool needed → {"instruction":"...", "element":{...}, "done":false}
    ├── get_accessibility_tree → SW re-scans, returns ARIA data → Claude re-reasons
    └── inspect_element → SW attaches debugger → Claude explains block
    │
    ▼
SW returns final step to content script
Content script: _findEl() + highlight + TTS
```

### Files to modify for 4B

- `src/background/background.js` → switch `_handleAnalyze` to Claude tool-use API; add tool handlers
- `src/content/assistant.js` → enrich `_scanPage()` with ARIA properties; add `_planSession()`
- `manifest.json` → add `"debugger"` permission (for `inspect_element` tool)
