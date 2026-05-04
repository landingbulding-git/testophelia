# Global System Flowchart

## Full System — Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHROME BROWSER                           │
│                                                                 │
│  ┌──────────────────┐    messages     ┌──────────────────────┐  │
│  │  background.js   │◄───────────────►│   content scripts    │  │
│  │  (service worker)│                 │   (every page)       │  │
│  │                  │  captureTab     │                      │  │
│  │  chrome.commands │────────────────►│  content.js          │  │
│  │  webNavigation   │  navigate       │  assistant.js        │  │
│  │  tabs.capture    │◄────────────────│  player.js           │  │
│  └──────────────────┘                 │  recorder.js         │  │
│           │                           │  overlay.js          │  │
│           │ chrome.storage            │  gemini-config.js    │  │
│           └──────────────────────────►│  gemini-tutor.js     │  │
│                                       │  agent-prompt.js     │  │
│  ┌──────────────────┐                 └──────────────────────┘  │
│  │   popup.html     │  sendMessage             │                │
│  │   popup.js       │◄─────────────────────────┘                │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
                                │ fetch (HTTPS)
                ┌───────────────┴──────────────┐
                ▼                              ▼
  ┌─────────────────────┐        ┌─────────────────────┐
  │  Cloudflare Worker  │        │  Cloudflare Worker  │
  │  workers/gemini.js  │        │  workers/firebase.js│
  │  (Claude proxy)     │        │  (Firebase proxy)   │
  └─────────────────────┘        └─────────────────────┘
                │                              │
                ▼                              ▼
  ┌─────────────────────┐        ┌─────────────────────┐
  │  Anthropic API      │        │  Firebase Realtime   │
  │  Claude Sonnet 4.5  │        │  Database           │
  └─────────────────────┘        └─────────────────────┘
```

---

## Agent Session Flowchart

```
                    ┌─────────────────┐
                    │  User on any    │
                    │  webpage        │
                    └────────┬────────┘
                             │ Ctrl+Shift+U
                             ▼
                    ┌─────────────────┐
                    │  _startMic()    │
                    │  Sphere → RED   │
                    │  Label: 🔴      │
                    └────────┬────────┘
                             │ user speaks goal
                             │
                    ┌────────┴────────┐
                    │  Ctrl+Shift+U   │◄── (second press)
                    │  _stopMic()     │
                    │  Sphere → orange│
                    └────────┬────────┘
                             │ transcript
                             ▼
                    ┌─────────────────┐
                    │ _startSession() │
                    │ _watchPage()    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
            ┌──────►│  _analyze()     │◄──────────────────┐
            │       └────────┬────────┘                   │
            │                │                            │
            │       ┌────────▼────────┐                   │
            │       │ _captureScreen()│                   │
            │       │ → background.js │                   │
            │       │ → JPEG base64   │                   │
            │       └────────┬────────┘                   │
            │                │                            │
            │       ┌────────▼────────┐                   │
            │       │  _scanPage()    │                   │
            │       │  → 90 elements  │                   │
            │       │  → indexed JSON │                   │
            │       └────────┬────────┘                   │
            │                │                            │
            │       ┌────────▼────────┐                   │
            │       │  _callClaude()  │                   │
            │       │  image + DOM +  │                   │
            │       │  history →      │                   │
            │       │  Claude Sonnet  │                   │
            │       └────────┬────────┘                   │
            │                │                            │
            │       ┌────────▼────────┐                   │
            │       │  Parse JSON     │                   │
            │       │  {instruction,  │                   │
            │       │   element, done}│                   │
            │       └────────┬────────┘                   │
            │                │                            │
            │          done? ├─── YES ──► TTS "Done!" ──► stop()
            │                │
            │                NO
            │                │
            │       ┌────────▼────────┐
            │       │  _speak()       │
            │       │  TTS instruction│
            │       └────────┬────────┘
            │                │
            │       ┌────────▼────────┐
            │       │  _findEl()      │
            │       │  player matcher │
            │       │  + text fallback│
            │       └────────┬────────┘
            │                │
            │          found? ├─── NO ──► _setDotLabel("Step N")
            │                │
            │               YES
            │                │
            │       ┌────────▼────────┐
            │       │scrollIntoView() │
            │       │double rAF       │
            │       │_highlightElement│
            │       │→ OpheliaOverlay │
            │       │→ orange dot     │
            │       │→ element glow   │
            │       └────────┬────────┘
            │                │
            │       waitingForAction = true
            │                │
            │    ┌───────────┴───────────┐
            │    │  _watchPage() events  │
            │    ├───────────────────────┤
            │    │  user click (900ms    │
            └────│  debounce)            │
                 │  URL change           │
                 │  voice correction     │
                 └───────────────────────┘
```

---

## STT Toggle State Machine

```
           ┌─────────────────────────────────────┐
           │            IDLE                     │
           │  _micActive = false                 │
           │  _active = false                    │
           │  Sphere: orange                     │
           └───────────────┬─────────────────────┘
                           │ Ctrl+Shift+U
                           ▼
           ┌─────────────────────────────────────┐
           │          LISTENING (goal)            │
           │  _micActive = true                  │
           │  Sphere: RED + glow                 │
           │  Label: 🔴 [live transcript]         │
           └─────────┬───────────────────────────┘
                     │ Ctrl+Shift+U (second press)
                     ▼
           ┌─────────────────────────────────────┐
           │          SESSION ACTIVE              │
           │  _active = true                     │
           │  _micActive = false                 │
           │  Sphere: orange                     │
           └───────┬─────────────────────────────┘
                   │ Ctrl+Shift+U (any time)
                   ▼
           ┌─────────────────────────────────────┐
           │       LISTENING (correction)         │
           │  _micActive = true                  │
           │  _active = true                     │
           │  Sphere: RED + glow                 │
           └─────────┬───────────────────────────┘
                     │ Ctrl+Shift+U (second press)
                     ▼
           ┌─────────────────────────────────────┐
           │  _userMessage(text) → _analyze()     │
           │  SESSION continues                  │
           └─────────────────────────────────────┘
```

---

## Tutorial Recording & Playback Flowchart

```
RECORDING                              PLAYBACK
─────────                              ────────
Creator opens target page         User receives share link
         │                                    │
         ▼                                    ▼
Ctrl+Shift+F                    Opens testophelia.vercel.app/tutorial.html?id=X
         │                                    │
         ▼                                    ▼
recorder.js starts               webNavigation detects URL
Mic activates (STT)              background.js → loadTutorial message
         │                                    │
         ▼                                    ▼
Each click captured              player.js fetches steps from Firebase
+ speech attached                            │
         │                                    ▼
         ▼                        For each step:
Ctrl+Shift+F stop                  findElement()
         │                         overlay.show()
         ▼                         TTS speaks
firebase.js Worker                 wait for click
saves steps → session ID                     │
         │                                   ▼
         ▼                         All steps done → complete
Share URL displayed                          
in popup
```

---

## Data Flow — Claude API Call

```
assistant.js                 Cloudflare Worker              Anthropic API
────────────                 ─────────────────              ─────────────
fetch POST ──────────────►  validate request
{                           inject API key         POST ──► /v1/messages
  model,                    build claudeBody ─────►        {model, system,
  max_tokens,               pass system param              messages, max_tokens}
  system,                                                         │
  messages: [                                                      ▼
    {role:"user",          ◄──────── forward response ──── {content:[{text:...}]}
     content:[img,text]},
    {role:"assistant",...},
    ...last 8 msgs
  ]
}
     │
     ▼
parse JSON from raw text
extract {instruction, element, done}
     │
     ├── done=true  → stop()
     └── done=false → _findEl() → highlight → TTS
```
