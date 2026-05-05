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

## 2. Streaming TTS (Reduce Perceived Latency)

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

## 3. Element Confidence Scoring

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

## 4. Screenshot Compression / Skipping (Cost Reduction)

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

## 5. Proactive Obstacle Detection

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

## 6. Cross-Page Memory (Session Persistence)

**Problem:** When the user navigates to a new page, `_messages` history is preserved in memory but lost on hard refresh or tab close.

**Proposed:**
- Serialize `{_goal, _messages, _stepCount}` to `chrome.storage.session` after each step
- On `content.js` init, check for a pending session and offer to resume (one TTS prompt: "Resume your task: [goal]?")
- Clear session storage on explicit `stop()`

**Benefit:** User can follow Ophelia's instructions across browser restarts or accidental refreshes.

---

## 7. Multi-Modal Element Search

**Problem:** Sometimes Claude returns an element that exists but is in a shadow DOM, inside an iframe, or rendered via canvas — none of which `_findEl()` can reach.

**Proposed:**
- After `_findEl()` fails, send Claude a **cropped screenshot** of the area where the element should be (based on Claude's described position) and ask: "Point to the element in this image using coordinates"
- Use those coordinates to `document.elementFromPoint(x, y)` as a last-resort finder
- For iframes: try `frame.contentDocument.querySelector(...)` with the same selector

---

## 8. Persona & Language Selection

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

## Architectural Improvement: Separate Agent Worker

**Current:** All agent logic runs in the content script, sharing the page's JS thread.

**Problem:** Heavy pages (e.g., Google Docs, Figma) can delay the agent loop because the browser's JS thread is saturated.

**Proposed:** Move `_callClaude()`, `_scanPage()`, and `_formatElements()` into a **Chrome Extension Service Worker** or **Offscreen Document**, communicating with the content script via `postMessage`. This keeps the UI thread free for smooth highlighting and TTS.
