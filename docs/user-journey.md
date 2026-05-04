# Global User Journey

Two distinct user types interact with Ophelia: the **Creator** (records tutorials) and the **Learner** (follows AI guidance or plays back tutorials).

---

## Journey A — AI-Guided Session (Intelligent Agent)

### Persona: Someone who wants help with an unfamiliar web task

```
TRIGGER
  User is on any webpage and needs help doing something.

STEP 1 — Invoke
  User presses Ctrl+Shift+U.
  → Sphere turns RED with glow.
  → Dot-label appears: "🔴 Listening… (press Ctrl+Shift+U to send)"

STEP 2 — State Goal
  User speaks their goal naturally:
  "I want to change my profile picture on Facebook"
  → Live transcript appears in dot-label as they speak.

STEP 3 — Commit
  User presses Ctrl+Shift+U again.
  → Sphere returns to orange.
  → "Thinking…" label appears at bottom-center.
  → Agent captures screenshot + scans DOM.
  → Claude identifies first step.

STEP 4 — Receive Guidance
  TTS speaks the instruction (e.g. "Click your profile photo").
  → Orange dot appears ON the target element.
  → Element glows with orange outline.
  → Dot-label disappears (dot is the indicator now).

STEP 5 — Take Action
  User clicks the highlighted element.
  → "Processing…" label appears briefly.
  → Agent captures new screenshot + re-scans DOM.
  → Claude identifies next step.

  [STEP 4–5 REPEAT until goal is complete]

STEP 6 — Completion
  TTS: "Done! Your goal is complete."
  → Dot-label: "✅ Done!"
  → All highlights clear.
  → Session ends automatically after 4 seconds.

INTERRUPTION — User wants to clarify or correct
  At any point: Ctrl+Shift+U → speak correction → Ctrl+Shift+U again.
  → Agent incorporates the message into the next analysis turn.
  → Conversation continues with full context of what's been done.

INTERRUPTION — User wants to stop
  Ctrl+Shift+U (if mic is open): commits and stops mic.
  If session is running but mic is closed: first press starts mic for correction.
  To fully stop: let the session end naturally or close the tab.
```

---

## Journey B — Tutorial Recording (Creator)

### Persona: A trainer or power user who wants to share a repeatable process

```
TRIGGER
  Creator navigates to the starting URL of the process they want to record.

STEP 1 — Start Recording
  Presses Ctrl+Shift+F  OR  clicks "Start Recording" in the popup.
  → Red recording dot appears in popup.
  → Sphere pulses red.
  → Microphone activates (for speech narration).

STEP 2 — Perform the Steps
  Creator performs each action on the page naturally.
  They speak the instruction for each step as they click:
  "Click the profile icon in the top right"
  → Each click is captured as a step with the spoken narration.
  → Recorder attaches the speech to the previous step automatically.

STEP 3 — Stop & Save
  Presses Ctrl+Shift+F again  OR  clicks "Stop & Save Tutorial".
  → Recording stops.
  → Steps are sent to Firebase via the Cloudflare Worker.
  → A shareable URL is generated and shown in the popup.

STEP 4 — Share
  Creator copies the link and shares it.
  → Recipient opens the link in Chrome.
  → Ophelia detects the tutorial URL and loads it automatically.
  → Tutorial playback begins (Journey C).
```

---

## Journey C — Tutorial Playback (Learner with a share link)

### Persona: A new user who received a tutorial link

```
TRIGGER
  User receives a link: https://testophelia.vercel.app/tutorial.html?id=XYZ

STEP 1 — Open Link
  User opens the link in Chrome with Ophelia installed.
  → Extension detects the URL pattern via webNavigation.
  → Sends loadTutorial message to the content script.
  → Tutorial steps are fetched from Firebase.

STEP 2 — Follow Along
  Player starts on Step 1:
  → Instruction card appears with step number and text.
  → TTS speaks the instruction.
  → Orange dot appears on the target element.
  → Element glows.
  User clicks the highlighted element.
  → Player advances to Step 2.

  [REPEATS for each step]

STEP 3 — Completion
  Final step completes.
  → "Tutorial complete!" message.
  → All overlays clear.
```

---

## Emotional Arc

```
Journey A (AI Agent):
  Confusion/uncertainty → [invoke] → curiosity → [guidance] →
  confidence → [completes task] → satisfaction + trust in tool

Journey B (Recording):
  Expertise → [record] → sense of contribution →
  [share] → teaching satisfaction

Journey C (Playback):
  Received help → [follow steps] → "I can do this" →
  [completes independently] → empowerment
```

---

## Friction Points to Eliminate

| Friction | Current State | Target State |
|---|---|---|
| Mic permission | Browser asks once, may block | Show clear instruction if permission denied |
| Vague goal → wrong first step | Agent guesses | Add clarification turn before first step |
| Element not found | No highlight, TTS still plays | TTS says "I couldn't find it, describe what you see" |
| Cross-page session loss | Session lost on refresh | Resume from `chrome.storage.session` |
| No feedback during "Thinking…" | Dot-label at bottom | Pulsing sphere + label while waiting for Claude |
| Recording speech timing | Speech attaches to previous step | Visual indicator of which step captures the speech |
