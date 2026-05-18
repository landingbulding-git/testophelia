# Ophelia — Product Vision

> **Status:** Core guide Creator → Playback loop implemented. AI co-pilot (Claude + vision) operational. Next: distraction detection, guide-aware co-pilot in player, multi-tab creator stability.

---

## What Ophelia Is

One product. Two roles.

**For creators** — record a complete guide once (across as many tabs and clicks as needed), share a link. Clients, employees, or teams follow it with 100% accuracy on their own screen.

**For users** — follow the guide step by step with highlighted elements and spoken narration. If something goes wrong, one shortcut summons the AI. It knows exactly where you are in the guide and helps you get unstuck, then continues.

---

## Creator Mode

**Goal:** Record complex, multi-tab guides without friction.

**How it works:**
- Creator clicks "Create Guide" in the popup → `CreatorLayer` mounts on the page
- Every click is intercepted: confirm overlay → fingerprint + screenshot captured → Claude generates narration asynchronously
- Recording persists across tab navigation and page loads via `opheliaCreatorSession` storage
- Sphere click to finish → wait for pending narrations → name + save dialog → `POST /guide` to Cloudflare KV → shareable link

**Step types:**

| Type | Status | Description |
|---|---|---|
| `click` | ✅ Current | Highlight + spoken narration |
| `video` | 🔜 Planned | Short inline clip (screen capture or webcam) plays instead of overlay card |

**Each step stores:**
- Fingerprint: `{ tag, ariaLabel, text, selector, xpath, position }`
- Screenshot (JPEG q=60)
- AI-generated narration
- `point: { x, y }` for overlay placement

---

## Player Mode

**Goal:** Users follow the guide with zero friction. The experience feels like a knowledgeable colleague walking them through it — one step at a time, precisely highlighted.

**Playback:**
- Overlay card: step number, instruction text, highlighted target element
- Spoken narration via TTS — brief, warm, natural
- Auto-advances on the right click or URL change
- Cross-tab resume: saves `opheliaGuidePending` before any navigation, resumes after page load

### Guide-Aware AI Co-Pilot

The AI is not a separate tool — it lives inside the player. Users never leave the guide to ask for help.

**Activation:** `Ctrl+Space` (or sphere click) while a guide is active

**What it knows:**
- The full guide: name, all steps, total count
- The current step: instruction, target element description, step index
- The live screen: screenshot captured at activation
- Page context: current URL and title

**What it can do:**
- Answer questions about the current step: *"Why am I clicking this?"*, *"What does this field do?"*
- Help unblock: *"The button isn't there — here's what to look for instead"*
- Speak responses aloud — one or two sentences, never a list

**After helping:** Ophelia offers to continue: *"Ready to go? I'll pick up from step 4."* User confirms → playback resumes automatically.

### Distraction Detection

While a guide is active, the player monitors whether the user is still engaged:

- **Trigger:** user navigates to an unrelated domain, or is idle from the guide for ~2 minutes, or makes 3+ unrelated clicks
- **Response:** Ophelia speaks gently — *"Looks like you wandered off — want to pause the guide or jump back in?"*
- **Options:** Pause (saves step index to storage) · Continue (resumes immediately) · Dismiss

---

## Voice & Personality

Ophelia speaks like an **exceptional customer success specialist**:

- Talks at the right moment — not after every click
- One or two sentences maximum
- Plain English, no jargon
- Warm, never robotic — confident, never apologetic
- Never explains what the user just did; only what to do next

---

## Guide Data Shape

```json
{
  "id": "uuid-v4",
  "name": "How to set up your first campaign",
  "domain": "mailchimp.com",
  "createdAt": 1748000000,
  "steps": [
    {
      "order": 0,
      "type": "click",
      "narration": "Hit the 'Create' button in the top right.",
      "screenshot": "<base64-jpeg>",
      "fingerprint": {
        "tag": "button",
        "ariaLabel": "Create",
        "text": "Create",
        "selector": ".nuni-button[aria-label='Create']",
        "xpath": "//button[@aria-label='Create']",
        "position": { "x": 1140, "y": 24 }
      },
      "point": { "x": 1140, "y": 24 }
    },
    {
      "order": 1,
      "type": "video",
      "narration": "Watch how the campaign wizard works.",
      "videoUrl": "https://worker.../clips/abc.mp4"
    }
  ]
}
```

---

## Architecture

```
CREATOR FLOW                        PLAYER FLOW
──────────────────────────────────  ──────────────────────────────────
Popup → "Create Guide"              Popup → "My Guides" / paste link
CreatorLayer mounts                 GET /guide/:id  (Cloudflare KV)
  ↳ click → screenshot → Claude        ↳ OpheliaPlayer.startGuide()
  ↳ narration + fingerprint               ↳ for each step:
  ↳ session persists across tabs             findElement (8-tier)
Sphere click → finish                         overlay + narration
POST /guide → KV → share link                 auto-advance
                                         distraction monitor
                                         Ctrl+Space → AI co-pilot
                                           (guide-aware Claude call)
                                         offer continue after help
```

**Cloudflare Worker routes (`ophelia-gemini-worker`):**

| Route | Purpose |
|---|---|
| `POST /claude` | Stream Claude Sonnet — AI assistant + step narration |
| `POST /tts` | ElevenLabs spoken narration |
| `POST /transcribe-token` | AssemblyAI token for creator mic |
| `POST /guide` | Save guide to KV; returns `{ id, shareUrl }` |
| `GET /guide/:id` | Load guide from KV |
| `POST /computer-use` | Pixel-precise element fallback (stub) |

---

## What's Next

| Feature | Priority | Notes |
|---|---|---|
| Distraction detection + pause/resume prompt | High | Monitor URL changes + idle time during playback |
| Guide-aware AI co-pilot in player | High | Inject guide + step index into Claude system prompt |
| Multi-tab creator session stability | High | Session persistence works; needs stress testing |
| Video step playback (`type: "video"`) | Medium | Inline `<video>` in overlay card |
| Video step recording (`type: "video"`) | Medium | Screen Capture API; clip stored in CF R2 |
| Creator step preview before save | Medium | Scrollable thumbnails + editable narration per step |
| Guide versioning (overwrite) | Low | Pass existing ID to `POST /guide` |

---

## Core Design Principles

1. **Guide-first, AI-on-demand.** The guide does 90% of the work. The AI steps in only when the user needs it.
2. **Talk like a person, not a product.** One sentence, right timing, plain English.
3. **Record everything, interrupt nothing.** Creator flow must be frictionless across tabs and navigations.
4. **Accuracy over coverage.** 100% correct on supported steps beats 70% correct on all steps.
5. **Context always travels with the player.** Guide plan, step index, and screen state are always available to the AI — no user ever has to re-explain what they're doing.
