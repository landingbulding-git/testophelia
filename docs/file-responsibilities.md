# File Responsibilities & Workflows

## Project Structure

```
src/
  background/  → Chrome service worker
  content/     → Injected into every page (the core runtime)
  popup/       → Extension popup UI
workers/       → Cloudflare Worker proxy (deployed separately)
docs/          → This folder
```

Load order (manifest.json `content_scripts`):
1. `overlay.js`
2. `player.js`
3. `assistant.js`
4. `content.js`

---

## `src/background/background.js`
**Role:** Chrome service worker — the only always-on process.

**Responsibilities:**
- Listens for `chrome.commands` (`toggle-sphere`) and relays to the active tab
- Handles `captureTab` → `chrome.tabs.captureVisibleTab()` → returns base64 JPEG
- Handles `navigate` → `chrome.tabs.update()` to change the tab URL
- Handles `analyze` → streams Claude Sonnet response with `[POINT:x,y:label]` tags; forwards `streamingText` and `earlyInstruction` events to the tab

**Does NOT:** hold UI state, inject DOM, manage conversations.

---

## `src/content/content.js`
**Role:** Coordinator / entry point for everything injected into the page.

**Responsibilities:**
- Creates and animates the **orange sphere** (follows mouse, parks bottom-right)
- Routes Chrome messages (`toggleSphere`, `startCreatorMode`, `startGuide`, `advanceGuide`) to the right module
- Listens for `keydown` (Ctrl+Space) as a reliable shortcut fallback
- Exposes `window.OpheliaNotify()` for toast notifications (used by all modules)
- On `DOMContentLoaded`: calls `_checkGuideParam`, `_checkCreatorSession`, `_checkGuidePending` for cross-tab resume

**Calls into:** `window.OpheliaAssistant`, `window.OpheliaPlayer`

---

## `src/content/assistant.js`
**Role:** AI co-pilot + guide creator.

**Responsibilities:**

**AI assistant (Ctrl+Space / sphere click):**
- Shows goal dialog with AssemblyAI mic input
- Multi-turn vision conversation with Claude (`_analyze` → `_callClaude`)
- Parses `[POINT:x,y:label]` tags to resolve DOM elements (`_resolveFromCoords`)
- Speaks responses via ElevenLabs `/tts` route (falls back to `speechSynthesis`)
- Highlights resolved element via `_highlightElement`

**Guide creation (CreatorLayer):**
- `startCreatorMode()` → mounts `CreatorLayer`, starts AssemblyAI streaming STT
- `CreatorLayer` intercepts clicks with a confirm overlay; records fingerprint + screenshot per step
- Each committed step asynchronously generates Claude narration
- On finish: shows `_showGuideSaveDialog`, uploads to `WORKER_BASE/guide`
- `resumeCreatorMode(session)` — restores in-progress recording after navigation

**Guide playback proxy:**
- `startGuide(guideOrId, startIndex)` — thin proxy to `window.OpheliaPlayer.startGuide()`

**Key state:**
| Variable | Purpose |
|---|---|
| `_isActive` | Goal dialog or AI session open |
| `_isLearning` | CreatorLayer is recording |
| `_isCreatorMode` | CreatorLayer mounted |
| `_messages` | Multi-turn conversation history |
| `_goal` | User's stated goal |
| `_micTeardown` | Teardown fn for AssemblyAI WebSocket |

---

## `src/content/overlay.js`
**Role:** Visual overlay — instruction card + element highlight.

**Responsibilities:**
- `show({stepNumber, totalSteps, instruction, element})` — renders instruction card, pulsing dot, element glow
- `hide()` — removes all overlay elements
- Used by `player.js` during guide playback

---

## `src/content/player.js`
**Role:** Guide playback engine + element finder.

**Responsibilities:**

**Guide playback (`startGuide`):**
- Loads guide from `WORKER_BASE/guide/:id` if given a string ID
- For each step: waits for DOM stability, re-identifies element, pre-saves next step to `opheliaGuidePending`, shows overlay, speaks narration, auto-advances on click/URL change
- `checkForPending()` — on every page load, resumes guide from `opheliaGuidePending` storage key
- `stop()` — clears playback, hides overlay, removes storage key

**Element finder (`findElement`):**
8-tier semantic matcher shared by guide playback and `_reidentifyElement`:
1. `aria-label` exact → case-insensitive → partial
2. `data-testid`
3. Anchored CSS selector + label check
4. Text + tag exact / starts-with
5. Text across interactive elements
6. Scored matching (all signals combined)
7. Generic CSS selector fallback
8. Spatial (100px radius)

**`_reidentifyElement(step)`:**
Adapts a CreatorLayer fingerprint to `findElement` format, then falls back to XPath, CSS selector, `elementFromPoint`.

---

## `src/popup/popup.html` + `popup.js`
**Role:** Extension popup UI.

**Responsibilities:**
- **Create Guide** button → sends `startCreatorMode` to active tab
- **My Guides** list → loads guides from `opheliaGuides` storage, play/copy-link per guide
- **Paste guide link** input → extracts UUID, sends `startGuide` to active tab

---

## `workers/ophelia.js`
**Role:** Cloudflare Worker proxy (deployed at `ophelia-gemini-worker.norbertb-consulting.workers.dev`).

**Routes:**
| Route | Purpose |
|---|---|
| `POST /claude` | Stream Claude Sonnet responses for the AI assistant |
| `POST /tts` | ElevenLabs text-to-speech |
| `POST /transcribe-token` | AssemblyAI streaming token for CreatorLayer mic |
| `POST /guide` | Save a guide to Cloudflare KV; returns `{ id, shareUrl }` |
| `GET /guide/:id` | Load a guide from KV |
| `POST /computer-use` | Computer Use API for pixel-precise element lookup |
