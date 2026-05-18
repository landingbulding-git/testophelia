# Ophelia Guide System — Creator & Playback

Full Creator → Guide → User loop is implemented.

---

## Current State

| What exists |
|---|
| `CreatorLayer` records fingerprint + screenshot + AssemblyAI narration per step |
| `_fingerprintElement` captures XPath, selector, aria-label, text, position |
| Guide saved to Cloudflare KV via `POST /guide`; shareable link returned |
| `OpheliaPlayer.startGuide` plays guide with 8-tier element re-identification |
| Auto-advance on click or URL change; cross-tab resume via `opheliaGuidePending` storage key |
| Popup: Create Guide button, My Guides list, paste-link input |

---

## Guide Data Shape

```json
{
  "id": "uuid-v4",
  "name": "How to create a Bubble app",
  "domain": "bubble.io",
  "createdAt": 1748000000,
  "steps": [
    {
      "order": 0,
      "narration": "Click the blue New App button in the top right.",
      "screenshot": "<base64-jpeg>",
      "action": "click",
      "fingerprint": { "tag": "button", "xpath": "...", "position": { "x": 340, "y": 88 } },
      "point": { "x": 340, "y": 88 }
    }
  ]
}
```

Screenshots are stored per step (JPEG q=60, ~15–40 KB each). Cloudflare KV TTL: 90 days.

---

## Architecture Map

```
CREATOR FLOW                          USER FLOW
──────────────────────────────────    ──────────────────────────────────
Popup → "Create Guide"            →   Popup → "My Guides" / paste link
_startCreatorRecording()               GET /guide/:id  (Cloudflare KV)
  ↳ click → screenshot → Claude         ↳ startGuide(guide)
  ↳ narration + [POINT:x,y]               ↳ for each step:
  ↳ fingerprint stored                       _speak(narration)
Sphere click → finish                        _reidentifyElement()
  ↳ Promise.all(narrations)                    1. XPath
  ↳ preview + save dialog                      2. elementFromPoint
POST /guide → KV → share link                 3. Computer Use API
                                             _highlightElement()
                                             waitForUserAdvance()
```

---

## What's Next

| Improvement | Notes |
|---|---|
| Computer Use fallback in `_reidentifyElement` | Tier 3 stub exists; needs `/computer-use` worker route wired up |
| Step preview in save dialog | Scrollable thumbnails + editable narration per step |
| Guide versioning / update | Allow creator to overwrite an existing guide ID |
