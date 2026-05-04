# File Responsibilities & Workflows

## Project Structure Overview

```
src/
  ai/          → AI configuration, prompts, legacy Gemini tutor
  background/  → Chrome service worker
  content/     → Injected into every page (the core runtime)
  popup/       → Extension popup UI
workers/       → Cloudflare Worker proxies (deployed separately)
web/           → Vercel-hosted tutorial viewer
docs/          → This folder
```

---

## `src/background/background.js`
**Role:** Chrome service worker — the only always-on process.

**Responsibilities:**
- Listens for `chrome.commands` (`toggle-sphere`, `send-firebase`) and relays them to the active tab via `sendMessage`
- Handles `captureTab` messages from content scripts → calls `chrome.tabs.captureVisibleTab()` and returns the base64 JPEG
- Handles `navigate` messages → calls `chrome.tabs.update()` to change the tab URL
- Detects tutorial share links (`testophelia.vercel.app/tutorial.html`) via `webNavigation.onCompleted` and tells the content script to load that session

**Does NOT:** hold any UI state, inject any DOM, manage conversations.

---

## `src/content/content.js`
**Role:** Coordinator / entry point for everything injected into the page.

**Responsibilities:**
- Creates and animates the **orange sphere** (follows mouse, parks bottom-right)
- Routes Chrome messages (`toggleSphere`, `toggleRecording`, `loadTutorial`, `getRecordingState`) to the right module
- Listens for `keydown` (Ctrl+Shift+U) directly as a reliable shortcut fallback
- Manages the legacy **Gemini Tutor** STT loop (during recording only)
- Exposes `window.OpheliaNotify()` for toast notifications (used by recorder/player)
- Exposes `window.scanDOM()` for legacy Gemini context

**Calls into:** `window.OpheliaAssistant`, `window.OpheliaRecorder`, `window.OpheliaPlayer`

---

## `src/content/assistant.js`
**Role:** The intelligent agent — continuous screen-aware co-pilot.

**Responsibilities:**
- Manages the full **agent session lifecycle**: start → analyze → highlight → wait → repeat
- Runs **multi-turn conversation** with Claude (up to 8 messages / 4 turns)
- Captures screenshots via background, scans the DOM for interactive elements
- Calls the **Claude Sonnet API** through the Cloudflare Worker proxy
- Finds the target element via `OpheliaPlayer.findElement()` + text-content fallback
- Highlights the element using `OpheliaOverlay.show()` (same dot + glow as the tutorial player)
- Speaks instructions via Web Speech Synthesis (TTS)
- Manages the **toggle-mic** STT loop (`_startMic` / `_stopMic`) — sphere turns red while recording
- Shows a small dot-label next to the orange pointer for status text

**Key state:**
| Variable | Purpose |
|---|---|
| `_active` | Whether a session is running |
| `_messages` | Multi-turn conversation history |
| `_goal` | User's stated goal for this session |
| `_micActive` | Whether the mic is open |
| `_waitingForAction` | Whether to react to the next click |

---

## `src/content/overlay.js`
**Role:** Visual overlay — orange dot + element highlight glow.

**Responsibilities:**
- Injects CSS for `.ophelia-target` (orange outline + glow animation on the target element) and `#ophelia-dot` (pulsing orange dot)
- `show({stepNumber, totalSteps, instruction, element})` — renders the instruction card, places the dot, highlights the element
- `hide()` — removes card, dot, and target highlight
- `pinTo(element)` — moves the dot to a new element mid-session
- `correction mode` — lets the recorder reselect a target element

**Used by:** `player.js` (tutorial playback), `assistant.js` (agent highlight)

---

## `src/content/player.js`
**Role:** Tutorial playback engine.

**Responsibilities:**
- Plays back a recorded step list sequentially
- For each step: finds the element (`findElement()`), calls overlay, speaks instruction, waits for user interaction
- `findElement(descriptor)` — multi-tier matcher: aria-label (partial, case-insensitive) → data-testid → CSS selector → text content scoring
- Handles cross-page navigation by saving pending steps to `chrome.storage.local` and resuming after load
- Exposes `window.OpheliaPlayer.findElement()` so `assistant.js` can reuse the matcher

---

## `src/content/recorder.js`
**Role:** Tutorial recording engine.

**Responsibilities:**
- Intercepts user clicks, inputs, and navigation to build a step list
- Attaches speech transcript (from content.js STT) to the current step
- Saves the completed recording to Firebase via the Cloudflare Worker
- Returns a shareable URL stored in `chrome.storage.local`

---

## `src/ai/gemini-config.js`
**Role:** Legacy Gemini API configuration.

**Responsibilities:**
- Reads the Gemini API key from `chrome.storage.local`
- Tests connectivity to the Cloudflare Worker
- Used only by `gemini-tutor.js`

---

## `src/ai/gemini-tutor.js`
**Role:** Legacy conversational Gemini tutor (pre-Claude agent).

**Responsibilities:**
- Manages a conversation history with the Gemini API
- Responds to STT transcripts with contextual help
- Largely superseded by `assistant.js` + Claude but kept for the old STT path during recording

---

## `src/ai/agent-prompt.js`
**Role:** Legacy agent system prompt (pre-Claude rewrite).

**Responsibilities:**
- Defines `AGENT_SYSTEM_PROMPT` — a router prompt that decides whether to call `shaveDOM()` for DOM data
- Exposes `window.AGENT_SYSTEM_PROMPT`
- No longer used by `assistant.js` (which has its own inline system prompt); kept as reference

---

## `src/popup/popup.html` + `popup.js`
**Role:** Extension popup UI.

**Responsibilities:**
- Shows recording state (dot, step count)
- Start/Stop Recording buttons
- Displays last tutorial share link with copy button
- Polls the active tab's recording state every 1.5 s

---

## `workers/gemini.js`
**Role:** Cloudflare Worker proxy for Claude + Gemini APIs.

**Responsibilities:**
- Accepts POST requests from content scripts
- Reads `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` from Cloudflare environment (never exposed to client)
- Forwards requests to the Anthropic Claude API
- Adds CORS headers so the extension can call it cross-origin
- Passes through the `system` parameter for Claude's structured JSON responses

---

## `workers/firebase.js`
**Role:** Cloudflare Worker proxy for Firebase.

**Responsibilities:**
- Saves recorded tutorial step lists to Firebase Realtime Database
- Returns a session ID used to construct the shareable URL

---

## `web/tutorial.html`
**Role:** Public tutorial viewer (deployed to Vercel).

**Responsibilities:**
- Loads a tutorial session by `?id=` query param
- Displays step-by-step instructions for users who receive a share link
- Triggers `loadTutorial` in the extension when opened in Chrome with Ophelia installed
