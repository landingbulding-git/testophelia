# Ophelia × Clicky — Vision-First Architecture Port Roadmap

> Based on a complete read of every file in `clicky-main/`. The goal is to replace
> Ophelia's current DOM-scan+index hybrid with Clicky's pure Vision-First pipeline,
> ported into Ophelia's Chrome Extension framework.

---

## The Core Philosophical Difference

| | Clicky | Ophelia (current) |
|---|---|---|
| **How it sees the page** | Screenshot only — never reads the DOM | Screenshot + `querySelectorAll` DOM scan |
| **How it finds elements** | Claude embeds `[POINT:x,y:label]` pixel coords in response → `document.elementFromPoint()` | Claude returns `elementIndex` → `_scannedRefs[i]` |
| **Voice input** | AssemblyAI WebSocket streaming (PCM16) | Browser `SpeechRecognition` API |
| **Voice output** | ElevenLabs via Cloudflare Worker proxy | Browser `speechSynthesis` |
| **Response format** | Natural language, conversational, TTS-optimized | JSON: `{instruction, elementIndex, done}` |
| **System prompt** | "You're a companion. Point at things with [POINT:x,y:label]." | "Return only valid JSON with elementIndex." |
| **Element precision** | Claude Computer Use API (`computer_20251124`) for pixel-exact coords | Index lookup into scanned DOM refs |

**Why Vision-First wins:** On React SPAs like Bubble, the DOM is unstable — aria labels change, elements re-render, indices go stale between scan and response. Clicky sidesteps all of this by treating the screen as a pixel image, exactly like a human does.

---

## Architecture Map: Clicky → Ophelia

```
CLICKY (macOS)                          OPHELIA (Chrome Extension)
────────────────────────────────────    ────────────────────────────────────
CGEvent tap (Ctrl+Option)           →   chrome.commands (Ctrl+Space)
AVAudioEngine → PCM16 chunks        →   MediaRecorder → PCM16 chunks
AssemblyAI WebSocket stream         →   AssemblyAI WebSocket stream  [NEW]
ScreenCaptureKit (all monitors)     →   chrome.tabs.captureVisibleTab
ClaudeAPI.analyzeImageStreaming()   →   background.js _handleAnalyze() SSE
[POINT:x,y:label] tag parser        →   NEW: _parsePointTag() in assistant.js
NSPanel overlay + bezier arc        →   OpheliaOverlay.show() + highlight ring
ElevenLabsTTSClient → AVAudioPlayer →   ElevenLabs → <audio> element  [NEW]
Cloudflare Worker /chat /tts /token →   Existing worker + 2 new routes [NEW]
```

---

## Phase 1 — Vision-Only Analysis (Drop the DOM Scan)

**What changes:** Remove the DOM element list from every Claude call entirely.
Claude stops receiving a JSON list of elements and instead receives only the screenshot.
The response format changes from JSON to natural language with an embedded `[POINT:x,y:label]` tag.

### 1.1 — New System Prompt (`background.js` `_handleAnalyze`)

Replace the current JSON-schema system prompt with Clicky's conversational format:

```js
const system =
  `You are Ophelia, a live browser co-pilot. The user can hear you — write for the ear, not the eye.\n` +
  `You see the user's browser via a screenshot. They are trying to accomplish a goal step by step.\n\n` +
  `RULES:\n` +
  `- Give ONE action per response. Two sentences max. Plain English, casual, warm.\n` +
  `- No markdown, no lists, no bullet points — this will be spoken aloud.\n` +
  `- Never say "simply" or "just".\n` +
  `- When referring to a UI element the user should click, point at it using the tag format below.\n\n` +
  `POINTING:\n` +
  `The screenshot is ${screenshotWidth}×${screenshotHeight} pixels (top-left = 0,0).\n` +
  `If you reference a clickable element, append at the very end of your response:\n` +
  `[POINT:x,y:label]  — e.g. [POINT:340,88:Data tab]\n` +
  `If no element to point at: [POINT:none]\n\n` +
  `GOAL: "${goal}"\n` +
  `Page: ${pageTitle} (${pageUrl})\n` +
  planCtx + platformCtx;
```

### 1.2 — Remove DOM Scan from `_analyze` (`assistant.js`)

Delete the `_scanPage()` call and `elStr` from `_analyze()`. The user content block becomes:

```js
const userContent = [];
if (screenshot) {
  userContent.push({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: screenshot }
  });
}
userContent.push({
  type: 'text',
  text: `Step ${_stepCount + 1}. ${trigger}`
});
```

No DOM list. No `_scannedRefs`. No `elementIndex`.

### 1.3 — Parse `[POINT:x,y:label]` from Response (`assistant.js`)

Add a `_parsePointTag(responseText)` function modeled directly on Clicky's
`CompanionManager.parsePointingCoordinates()`:

```js
function _parsePointTag(text) {
  // Matches [POINT:123,456:label] or [POINT:none] at end of response
  const m = text.match(/\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]]+))?)\]\s*$/);
  if (!m) return { spokenText: text, x: null, y: null, label: null };
  const spokenText = text.slice(0, m.index).trim();
  if (!m[1]) return { spokenText, x: null, y: null, label: 'none' };
  return { spokenText, x: parseInt(m[1]), y: parseInt(m[2]), label: m[3] || null };
}
```

### 1.4 — Map Screenshot Coordinates → DOM Element (`assistant.js`)

Replace `_resolveEl()` with `_resolveFromCoords()`:

```js
function _resolveFromCoords(screenshotX, screenshotY) {
  // chrome.tabs.captureVisibleTab captures at devicePixelRatio scale.
  // Divide by DPR to convert screenshot pixels → CSS layout pixels.
  const dpr = window.devicePixelRatio || 1;
  const cssX = Math.round(screenshotX / dpr);
  const cssY = Math.round(screenshotY / dpr);
  const el = document.elementFromPoint(cssX, cssY);
  if (!el || el === document.body || el === document.documentElement) return null;
  console.log(`✅ _resolveFromCoords: (${screenshotX},${screenshotY}) → CSS (${cssX},${cssY}) → <${el.tagName}>`);
  return el;
}
```

**Why this works:** `document.elementFromPoint()` is pixel-perfect. No matching, no scoring,
no stale refs. Same technique Clicky uses after its `NSPanel` coordinate mapping.

### 1.5 — Update `_analyze` to use new flow

```js
const parsed = await _callClaude();          // now returns {spokenText, x, y, label, done}
const el = (parsed.x != null) ? _resolveFromCoords(parsed.x, parsed.y) : null;
if (!parsed._instructionSpoken) _speak(parsed.spokenText);
if (el) {
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  requestAnimationFrame(() => requestAnimationFrame(() => _highlightElement(el)));
}
```

### 1.6 — Update Background JSON Parsing (`background.js`)

The fast-path parser changes from extracting `elementIndex` to extracting the full response text
and the POINT tag. Strip the JSON response format entirely — the response is now raw text:

```js
// Fast path: accumulate full stream text, then parse POINT tag
// Return: { spokenText, x, y, label, done, _instructionSpoken }
const pointTag = raw.match(/\[POINT:[^\]]+\]/);
// early-fire TTS on first ~words before the POINT tag appears
```

**Files changed:** `src/background/background.js`, `src/content/assistant.js`
**Files deleted logic:** `_scanPage`, `_scannedRefs`, `_resolveEl`, `_formatElements`
**Outcome:** Claude sees only what a human sees. Zero DOM dependency.

---

## Phase 2 — Computer Use API for Pixel-Exact Element Location

**What Clicky does:** When element coordinates come back from Claude but are imprecise,
`ElementLocationDetector.swift` makes a second Claude call using the `computer_20251124` beta
header. This activates Claude's specialized pixel-counting training, which is significantly
more accurate than regular vision API coordinate extraction.

**Ophelia port:** Add a `/computer-use` route to the existing Cloudflare Worker, called only
when `document.elementFromPoint()` returns `null` or `document.body`.

### 2.1 — Add `/computer-use` Route to Worker (`workers/gemini.js` or new worker)

```ts
// POST /computer-use { screenshot: base64, question: string, width: number, height: number }
async function handleComputerUse(body, env) {
  // Pick best aspect-ratio-matched resolution (same logic as ElementLocationDetector.swift)
  const targetRes = bestComputerUseResolution(body.width, body.height);
  // Resize image to targetRes client-side or server-side
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'computer-use-2025-11-24',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 256,
      tools: [{ type: 'computer_20251124', name: 'computer',
                 display_width_px: targetRes.w, display_height_px: targetRes.h }],
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.screenshot } },
        { type: 'text', text: `The user wants to: "${body.question}". Click the relevant UI element.` }
      ]}]
    })
  });
  const data = await response.json();
  // Parse tool_use block: { action: "left_click", coordinate: [x, y] }
  const toolBlock = data.content?.find(b => b.type === 'tool_use');
  const coord = toolBlock?.input?.coordinate;
  return { x: coord?.[0] ?? null, y: coord?.[1] ?? null,
           targetWidth: targetRes.w, targetHeight: targetRes.h };
}
```

**Aspect-ratio resolution table** (from `ElementLocationDetector.swift`):
- 4:3 displays → 1024×768
- 16:10 displays (most MacBooks) → 1280×800
- ~16:9 displays → 1366×768

### 2.2 — Fallback in `_resolveFromCoords` (`assistant.js`)

```js
async function _resolveFromCoords(x, y, screenshot, instruction) {
  // Primary: direct point from Claude's inline coordinates
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(Math.round(x / dpr), Math.round(y / dpr));
  if (el && el !== document.body) return el;

  // Fallback: Computer Use API for pixel-precise re-detection
  if (screenshot && instruction) {
    const coords = await _computerUseLookup(screenshot, instruction);
    if (coords) {
      const el2 = document.elementFromPoint(
        Math.round(coords.x * window.innerWidth  / coords.targetWidth),
        Math.round(coords.y * window.innerHeight / coords.targetHeight)
      );
      if (el2 && el2 !== document.body) return el2;
    }
  }
  return null;
}
```

**Files changed:** `workers/gemini.js` (or new `workers/computer-use.js`), `src/content/assistant.js`
**Outcome:** Element location is as accurate as Clicky's on a Mac — pixel-counting model, not text matching.

---

## Phase 3 — ElevenLabs TTS (Replace Browser `speechSynthesis`) - no need now

**What Clicky does:** `ElevenLabsTTSClient.swift` sends text to `/tts` on the Cloudflare Worker,
receives an MP3 audio buffer, plays it via `AVAudioPlayer`. Exposes `isPlaying` for overlay scheduling.

**Why this matters for Ophelia:** Browser `speechSynthesis` sounds robotic, cuts off mid-sentence
on long instructions, and varies wildly between OS/browser versions. ElevenLabs produces the
warm, natural voice that makes guidance feel like a companion, not a screen reader.

### 3.1 — Add `/tts` Route to Cloudflare Worker

The route is identical to Clicky's worker — copy it directly:

```ts
// POST /tts  { text: string, voice_settings?: object }
async function handleTTS(body, env) {
  const voiceId = env.ELEVENLABS_VOICE_ID;
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY,
                 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: body.text, model_id: 'eleven_flash_v2_5',
                             voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    }
  );
  return new Response(response.body, { headers: { 'content-type': 'audio/mpeg' } });
}
```

Add `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` as Wrangler secrets.

### 3.2 — Replace `_speak()` in `assistant.js`

```js
async function _speak(text, onEnd) {
  if (!text) { onEnd?.(); return; }
  // Strip markdown, POINT tags, etc.
  const cleanText = text.replace(/\[POINT:[^\]]+\]/g, '').trim();
  try {
    const res = await fetch(CLAUDE_WORKER.replace('/claude', '/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText })
    });
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
    audio.play();
    _currentAudio = audio;
  } catch (_) {
    // Fallback to browser TTS if ElevenLabs fails
    const utt = new SpeechSynthesisUtterance(cleanText);
    utt.rate = _ttsRate;
    utt.onend = onEnd;
    window.speechSynthesis.speak(utt);
  }
}
```

Add `let _currentAudio = null;` to state variables. Call `_currentAudio?.pause()` on `stop()`.

**Files changed:** `src/content/assistant.js`, `workers/gemini.js`
**New secret:** `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` in Wrangler
**Outcome:** Natural, warm voice. Instructions sound like a person, not a robot.

---

## Phase 4 — AssemblyAI Streaming STT (Replace Web Speech API) no need now.

**What Clicky does:** `BuddyDictationManager.swift` captures audio via `AVAudioEngine`,
converts to PCM16 mono via `BuddyAudioConversionSupport.swift`, and streams chunks over
a WebSocket to AssemblyAI's v3 real-time API. A short-lived token from `/transcribe-token`
avoids shipping the API key in the app.

**Why this matters for Ophelia:** Browser `SpeechRecognition` drops after ~60 seconds of silence,
has no partial transcript display in Chrome, and fails entirely on many corporate networks.
AssemblyAI's `u3-rt-pro` model is dramatically more accurate and reliable.

### 4.1 — Add `/transcribe-token` Route to Worker

Identical to Clicky's route:

```ts
// POST /transcribe-token (no body needed)
async function handleTranscribeToken(env) {
  const res = await fetch(
    'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480',
    { headers: { authorization: env.ASSEMBLYAI_API_KEY } }
  );
  const data = await res.text();
  return new Response(data, { headers: { 'content-type': 'application/json' } });
}
```

### 4.2 — New `_startMic()` implementation (`assistant.js`)

Replace `SpeechRecognition` with an AssemblyAI WebSocket session:

```js
async function _startMic(onFinal) {
  // 1. Get a short-lived token (480s) from the worker
  const tokenRes = await fetch(CLAUDE_WORKER.replace('/claude', '/transcribe-token'),
                               { method: 'POST' });
  const { token } = await tokenRes.json();

  // 2. Capture microphone as raw PCM16 via AudioContext
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx    = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const proc   = ctx.createScriptProcessor(4096, 1, 1);

  // 3. Open AssemblyAI v3 WebSocket with the temp token
  const ws = new WebSocket(
    `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token=${token}`
  );

  ws.onopen = () => {
    proc.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Convert Float32 → Int16 PCM
      const float32 = e.inputBuffer.getChannelData(0);
      const int16   = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++)
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
      ws.send(int16.buffer);
    };
    source.connect(proc);
    proc.connect(ctx.destination);
  };

  // 4. Accumulate final transcript turns
  let finalText = '';
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'FinalTranscript' && msg.text) {
      finalText += msg.text + ' ';
      _setDotLabel(`🔴 ${finalText.trim().slice(-60)}`);
    }
  };

  // Return teardown function — called on second Ctrl+Space press
  _micTeardown = () => {
    proc.disconnect(); source.disconnect();
    stream.getTracks().forEach(t => t.stop());
    ctx.close();
    ws.close();
    onFinal(finalText.trim());
  };
}
```

**Key pattern:** Matches Clicky's shared-session approach — one WebSocket per recording session,
closed on key-up. The `_micTeardown` closure maps to Clicky's `_stopMic()` → `ws.close()`.

**Files changed:** `src/content/assistant.js`, `workers/gemini.js`
**New secret:** `ASSEMBLYAI_API_KEY` in Wrangler
**Outcome:** Real-time transcription with partials, no 60-second timeout, no network failures.

---

## Phase 5 — Streaming Response Display

**What Clicky does:** `ClaudeAPI.analyzeImageStreaming()` calls `onTextChunk` on every SSE delta,
updating `streamingResponseText` on `CompanionManager` which the `OverlayWindow` renders in
a speech bubble next to the blue cursor.

**Current Ophelia behavior:** Fast path extracts the `instruction` field from JSON early, speaks it,
then discards the stream. Response display is just the dot label "Step N".

### 5.1 — Show Progressive Response in Sphere Label

In `background.js` fast-path stream loop, as text accumulates:

```js
// Send partial spoken text to content script for progressive display
if (tabId && raw.length > 0) {
  const partial = raw.replace(/\[POINT:[^\]]+\]$/, '').trim();
  if (partial !== lastPartial) {
    lastPartial = partial;
    chrome.tabs.sendMessage(tabId, { action: 'streamingText', text: partial }).catch(() => {});
  }
}
```

In `content.js` / `assistant.js`, handle `streamingText` to update the dot label:

```js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'streamingText') _setDotLabel(msg.text.slice(-80));
});
```

### 5.2 — ElevenLabs TTS fires AFTER full response (like Clicky)

Clicky intentionally waits for the full response text before sending to ElevenLabs (TTS needs
the complete sentence). The early-instruction fire stays but the audio waits:

```js
// After stream completes: parse POINT tag, speak full spokenText, highlight element
const { spokenText, x, y } = _parsePointTag(raw);
await _speak(spokenText);
const el = (x != null) ? await _resolveFromCoords(x, y, screenshot, spokenText) : null;
if (el) _highlightElement(el);
```

**Files changed:** `src/background/background.js`, `src/content/assistant.js`

---

## Phase 6 — Session Planner Overhaul

**What Clicky does:** There is no separate "planning" phase. Claude sees the screenshot and
conversation history and simply knows what to say next. The system prompt contains the goal
context inline.

**Ophelia's current approach:** Generates a structured plan array upfront via Haiku, then feeds
it as `planCtx` to every subsequent Claude call. This creates brittle plans that go stale
after the first navigation.

### 6.1 — Replace Structured Plan with Rolling Summary

Instead of generating a plan array, maintain a one-sentence "what we've done so far" summary
that gets prepended to each Claude call. Like Clicky's `conversationHistory`, this is trimmed
to the last 10 exchanges:

```js
// In _analyze(), replace planCtx with:
const historyCtx = _messages.length > 2
  ? `\nRecent actions: ${_messages.slice(-4)
      .filter(m => m.role === 'assistant')
      .map(m => m.content)
      .join(' → ')}`
  : '';
```

### 6.2 — Keep Vision-Driven Plan for Complex Goals

For complex goals (Bubble data types, Google Console project), the Thinking MCP still generates
a checklist. But instead of passing the raw plan steps to Claude, format them as a single
"session context" sentence:

```
CONTEXT: The user is working on: "set up Bubble data types". Progress so far: [step 1 done, step 2 done].
Next expected milestone: Create the User data type fields.
```

---

## Phase 7 — Worker Consolidation

Merge all routes into the existing `workers/gemini.js` (or a renamed `workers/ophelia.js`):

| Route | Purpose | Secret needed |
|---|---|---|
| `POST /claude` | Claude Sonnet (existing) | `ANTHROPIC_API_KEY` |
| `POST /tts` | ElevenLabs TTS | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |
| `POST /transcribe-token` | AssemblyAI temp token | `ASSEMBLYAI_API_KEY` |
| `POST /computer-use` | Claude Computer Use API | `ANTHROPIC_API_KEY` (shared) |
| `POST /think` | Thinking MCP (existing) | `ANTHROPIC_API_KEY` |

```bash
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put ELEVENLABS_VOICE_ID
npx wrangler secret put ASSEMBLYAI_API_KEY
```

---

## Implementation Order & Effort

| Phase | Effort | Unlocks | Do First? |
|---|---|---|---|
| 1 — Vision-only analysis | 3–4h | Eliminates all element-matching bugs | ✅ Yes |
| 2 — Computer Use fallback | 2h | Pixel-exact element detection | After Phase 1 |
| 3 — ElevenLabs TTS | 2h | Natural voice, stops robotic TTS | ✅ Yes |
| 4 — AssemblyAI STT | 4h | Reliable voice input | After Phase 3 |
| 5 — Streaming display | 1h | Progressive text in sphere | After Phase 1 |
| 6 — Planner overhaul | 2h | Coherent multi-step sessions | After Phase 1 |
| 7 — Worker consolidation | 1h | Clean deployment | Last |

**Recommended first sprint:** Phases 1 + 3 + 5. These three together transform Ophelia
from a DOM-scraping JSON machine into a vision-first companion that sounds and feels like Clicky.
Phases 2 and 4 are quality upgrades — ship after initial testing.

---

## Key Clicky Patterns to Preserve Exactly

### 1. TLS Warmup (`ClaudeAPI.swift:66`)
Clicky fires a HEAD request to the Worker host on init to pre-warm the TLS connection,
eliminating cold-start latency on the first real API call. Port this to the extension's
background.js `install` event:

```js
chrome.runtime.onInstalled.addListener(() => {
  fetch(CLAUDE_WORKER, { method: 'HEAD' }).catch(() => {});
});
```

### 2. Cancel-on-new-utterance (`CompanionManager.swift:495`)
Clicky cancels `currentResponseTask` when the user presses the shortcut again. Ophelia
already does this in `stop()`, but should also abort in-flight ElevenLabs audio and
any pending Computer Use requests when the user clicks.

### 3. Coordinate clamping (`CompanionManager.swift:660`)
Always clamp returned coordinates to `[0, screenshotWidth] × [0, screenshotHeight]`
before mapping — Claude occasionally returns values slightly outside the declared dimensions.

```js
const clampedX = Math.max(0, Math.min(x, screenshotWidth));
const clampedY = Math.max(0, Math.min(y, screenshotHeight));
```

### 4. POINT tag at very end of response
Clicky's regex matches the tag only at `$` (end of string). If Claude puts it mid-response,
the regex fails gracefully and no pointing happens — better than misreading coordinates.
The Ophelia regex must do the same: `\[POINT:[^\]]+\]\s*$`.

### 5. DPR scaling (browser-specific, not in Clicky)
Clicky uses AppKit point coordinates which are already DPR-independent. In the browser,
`chrome.tabs.captureVisibleTab` captures at the native pixel resolution (DPR × CSS pixels).
**Always divide screenshot coordinates by `window.devicePixelRatio`** before calling
`document.elementFromPoint()`. This is the single most common coordinate bug in browser extensions.

---

## Files to Create / Modify

### Modify
- `src/content/assistant.js` — Remove `_scanPage`, `_scannedRefs`, `_resolveEl`, `_formatElements`; add `_parsePointTag`, `_resolveFromCoords`, new `_speak`, new `_startMic`
- `src/background/background.js` — New system prompt, remove elementIndex schema, add streaming text relay, update `_handleAnalyze` response parser
- `workers/gemini.js` — Add `/tts`, `/transcribe-token`, `/computer-use` routes

### Create
- None required — all changes fit in existing files

### Delete (or archive)
- `src/ai/agent-prompt.js` — Legacy prompt loaded as content script, never used by current Claude flow; remove from `manifest.json` content_scripts array
- `docs/element-flow.md` — Documents the index-based approach being replaced

---

## What Stays the Same

- `chrome.tabs.captureVisibleTab` for screenshots (Clicky's ScreenCaptureKit equivalent)
- `OpheliaOverlay.show()` for element highlighting (Clicky's bezier animation equivalent)
- Cloudflare Worker as API key proxy (identical pattern)
- `chrome.storage.session` for cross-page session persistence
- Obstacle detection (`_handleCheckObstacle`) via Haiku — no change needed
- Goal clarification (`_handleClarifyGoal`) via Haiku — no change needed
- MCP Gateway for platform knowledge — no change needed
- Thinking MCP for complex goals — no change needed
