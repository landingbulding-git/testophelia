# AI Current Mechanism & Prompts

## Architecture Overview

Ophelia uses **Claude Sonnet 4.5** as its reasoning engine, accessed via a **Cloudflare Worker proxy** that holds the API key server-side. The agent runs entirely inside the Chrome content script — no native app, no server session.

```
User (voice) → STT → _analyze() → Claude API (via Worker) → step JSON → TTS + highlight
                          ↑                                                      ↓
                    screenshot + DOM scan                               user clicks element
                                                                               ↓
                                                                        _analyze() again
```

---

## The Agent Loop (`assistant.js`)

### 1. Goal Capture
- `Ctrl+Shift+U` → `_startMic()` → `SpeechRecognition` (continuous mode, `continuous: true`)
- Live transcript shown in dot-label next to the orange sphere
- Second `Ctrl+Shift+U` → `_stopMic()` → final transcript → `_startSession(goal)`

### 2. Per-Step Analysis (`_analyze`)
Each analysis turn does four things in sequence:

| Step | Function | Output |
|---|---|---|
| Screenshot | `_captureScreen()` | Base64 JPEG via `background.js` |
| DOM scan | `_scanPage()` | Up to 90 interactive elements with position info |
| Format elements | `_formatElements()` | Indexed JSON list (verbatim attributes) |
| Call Claude | `_callClaude()` | Structured JSON step |

### 3. Multi-Turn Conversation History
- `_messages[]` stores alternating `user` / `assistant` turns
- **Max 8 messages** (4 turns) — older turns are trimmed to cap token cost
- **Images are stripped** from all turns except the latest user turn — replaced with `"[screenshot from previous step]"` to preserve context without token cost

### 4. Re-analysis Triggers
The agent re-analyzes after:
- Any user **click** (debounced 900ms) — via `_watchPage()`
- **URL change** — polled every 300ms
- Explicit **voice correction** via mid-session `Ctrl+Shift+U`

---

## System Prompt (inline in `_callClaude`)

```
You are Ophelia, a live browser co-pilot. You see the user's browser via
screenshots and a DOM element list. After every user action you receive a
new screenshot and DOM state.

YOUR ONLY JOB: identify the single next action the user must take to reach
their goal.

RULES:
1. One action per response. Never combine multiple actions.
2. For elements in the DOM list: copy their JSON attributes verbatim into "element".
3. For elements not yet visible (inside menus/dialogs not yet open): use your site knowledge.
4. Instructions: short, plain English, max 12 words.

RESPOND WITH ONLY VALID JSON — no prose, no markdown fences:
{"instruction":"short action","element":{"tag":"","aria_label":"","text_content":"","role":""},"done":false}
When the goal is fully achieved: {"instruction":"All done!","done":true,"element":null}
```

### Why this prompt works
- **"Copy verbatim"** — prevents Claude paraphrasing aria-labels which breaks element matching
- **"One action"** — prevents multi-step responses that confuse the step counter
- **"Max 12 words"** — keeps TTS instructions short and natural
- **JSON-only** — eliminates prose noise and makes parsing deterministic

---

## DOM Scanning (`_scanPage`)

Scans these selectors:
```
button, a[href], input, select, textarea,
[role="button"], [role="link"], [role="menuitem"],
[role="option"], [role="tab"], [role="checkbox"],
[role="switch"], [role="radio"], [aria-label], [data-testid]
```

**Filters applied:**
- Hidden (`display:none`, `visibility:hidden`, `opacity:0`) → excluded
- Zero-size elements → excluded
- Off-screen with large buffer: viewport + 500px above, 1500px below, 300px sides → included (captures sticky navs, sidebars, below-fold elements)
- Deduplication by `label|tag` key

**Output per element:**
```json
{
  "tag": "button",
  "role": "button",
  "aria_label": "Search Facebook",
  "data_testid": null,
  "text_content": "Search",
  "position": "top-center"
}
```

Formatted as indexed list for Claude:
```
[ 0] @top-center  {"tag":"button","aria_label":"Search Facebook"}
[ 1] @mid-left    {"tag":"a","text_content":"Home"}
...
```

---

## Element Finding (`_findEl`)

Two-tier lookup:

**Tier 1 — `OpheliaPlayer.findElement()`**
Multi-tier matcher from `player.js`:
1. `aria-label` exact → partial (case-insensitive)
2. `data-testid` exact
3. CSS selector
4. Text content scoring (visible, interactive, in viewport)

**Tier 2 — Text fallback (in `assistant.js`)**
If Tier 1 returns null, brute-force scan of all interactive elements for substring match on `aria-label` or `textContent`.

---

## Element Highlighting

Uses `OpheliaOverlay.show()` — same as the tutorial player:
- **`.ophelia-target`** class → orange outline + glow animation on the element
- **`#ophelia-dot`** → pulsing orange circle, centered on the element
- Instruction card (`#ophelia-card`) is immediately removed (TTS handles the instruction)
- Dot is repositioned 250ms after placement to absorb late layout shifts
- Fallback: if overlay unavailable, injects its own CSS + dot directly

---

## Voice I/O

### STT (input)
- `SpeechRecognition` with `continuous: true`, `interimResults: true`
- Accumulates `isFinal` segments in `_micFinalText`
- Shows live interim transcript in dot-label
- Auto-restarts on Chrome's ~60s silence timeout
- Stopped explicitly by second `Ctrl+Shift+U` press

### TTS (output)
- `SpeechSynthesisUtterance` at rate 1.05
- Prefers Google / Samantha / Natural English voices
- Cancelled on `stop()` and before each new utterance

---

## Cloudflare Worker (`workers/gemini.js`)

Proxy endpoint: `https://ophelia-gemini-worker.norbertb-consulting.workers.dev/claude`

Request body passed through:
- `model` (default: `claude-sonnet-4-5`)
- `max_tokens` (default: 1500, agent uses 400)
- `messages` (multi-turn array)
- `system` (the system prompt string)

The worker injects the `x-api-key` header from the `ANTHROPIC_API_KEY` environment variable and forwards to `https://api.anthropic.com/v1/messages`.

---

## Token Cost Estimate

| Item | ~Tokens |
|---|---|
| System prompt | ~180 |
| Current screenshot (JPEG 70%) | ~1,200–2,000 |
| Current DOM list (90 elements) | ~800 |
| Previous turn text (×3 turns) | ~300–600 |
| **Total per step** | **~2,500–3,600** |

At Claude Sonnet pricing (~$3/MTok input, ~$15/MTok output):
- ~$0.008–0.011 per step input
- ~$0.001 per step output (400 tokens max)
- **~$0.01 per guidance step**
