# Ophelia Creator Recording Layer — Interaction Spec

> Extends Phase 2 of `guide-system-roadmap.md`.  
> Defines the overlay layer, confirm/edit micro-interaction, screenshot timing, and data shape additions.

---

## Mental Model

During a recording session the creator is a **director**, not just a user.  
Ophelia works on a **separate transparent layer** on top of the page — it intercepts intent before any page action fires, confirms it with the creator, then commits or discards.

```
PAGE CONTENT  ←  never touched until creator confirms
     ↑
OPHELIA LAYER  ←  captures hover + click, shows highlights + icons
     ↑
CREATOR INPUT  ←  hovers, clicks, chooses Accept or Edit
```

---

## Three States of the Layer

### State 0 — Scanning (idle)

Layer is mounted. Creator moves the mouse freely.

- Every element under the cursor gets a **live boundary preview**:  
  soft `2px dashed` outline in `rgba(139, 92, 246, 0.5)` (Ophelia purple), no fill.
- A floating micro-label shows the element's `tag + aria-label || innerText[:24]` near the cursor.
- No click is committed yet. Page behaves normally.
- Dot label: `🔴 Recording — hover to select`

---

### State 1 — Captured (pre-choice)

Creator clicks. The layer intercepts the event (`capture: true`, `preventDefault()`).

**Immediately, before any icon appears:**

1. **Screenshot is taken** — `_captureScreen()` fires at this exact moment.  
   This preserves the authentic page state: cursor in position, element visible, no UI chrome from Ophelia yet.

2. **Element is locked** — a `position: fixed` highlight frame is drawn on top of the element using its `getBoundingClientRect()`. Style: `3px solid rgba(139, 92, 246, 0.9)` with a `box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.2)` outer glow. Animated in with a `scale(0.96) → scale(1.0)` spring (80ms).

3. **Page scroll is locked** — `document.body.style.overflow = 'hidden'` for the duration of the choice.

4. **Confirm icons animate in** — two pill buttons appear near the element (see layout below).

Dot label: `🔴 Recording — confirm selection`

---

### State 2A — Accepted

Creator taps the **Accept** icon.

1. Highlight frame flashes green (`rgba(16, 185, 129, 0.9)`) for 200ms.
2. A `✓ Step N saved` micro-toast appears inside the highlight frame and fades out over 600ms.
3. Step object is assembled and pushed to `pendingSteps[]` (see Data Shape).
4. Async Claude narration fires (non-blocking, same as Phase 2.2).
5. Scroll lock released. Highlight removed.
6. Layer resets to **State 0** — ready for next element.

Dot label: `🔴 Recording — Step N+1`

---

### State 2B — Edit (retry)

Creator taps the **Edit** icon.

1. Highlight frame flashes red (`rgba(239, 68, 68, 0.9)`) for 200ms.
2. A translucent red **exclusion stamp** (`rgba(239, 68, 68, 0.12)` fill + `✕` centered) is pinned over the element. It stays visible for the rest of this step's selection process.
3. The rejected element's fingerprint is pushed to `currentStep.excludedElements[]`.
4. Scroll lock released.
5. Layer resets to **State 0** — same flow, but excluded elements are:
   - Rendered with the red stamp **on hover** (instead of purple preview).
   - Not selectable — click on them triggers a brief shake animation and does nothing.
6. Creator clicks a different element → **State 1** again.

This loop repeats until the creator accepts.

Dot label: `🔴 Recording — reselect (N wrong)`

---

## Confirm Icons — Layout & Animation

Two pill-shaped buttons rendered in a `position: fixed` container that hugs the highlight frame.

### Positioning Logic

```
preferred: directly above the element, horizontally centered
fallback 1: below the element (if < 80px above viewport top)
fallback 2: to the right (if element is > 80% viewport width wide)
```

Offset from highlight edge: `12px` gap.

### Accept Button

```
background: #10B981  (emerald-500)
icon: checkmark SVG (20px, white, stroke-width 2.5)
label: "Accept"
font: 13px medium, white
padding: 8px 16px
border-radius: 999px
box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4)
```

**Entrance animation:** scale from `0.5` → `1.0` + fade in, 160ms, `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring overshoot).  
**Hover state:** `brightness(1.1)` + slight upward translate (`-2px`).  
**Active state:** `scale(0.95)`.

### Edit Button

```
background: #F59E0B  (amber-500)
icon: refresh/repeat SVG (18px, white, stroke-width 2.5)
label: "Edit"
font: 13px medium, white
padding: 8px 16px
border-radius: 999px
box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4)
```

**Entrance animation:** same spring, staggered `+40ms` after Accept button.  
**Hover state:** same as Accept.  
**Active state:** icon does a 180° clockwise rotation over 300ms on click (suggests "redo").

Both buttons are destroyed (`remove()`) the moment either is tapped.

---

## Screenshot Timing — Exact Sequence

```
creator click
     │
     ├─ 1. event.preventDefault() + event.stopPropagation()
     ├─ 2. _captureScreen()  ← screenshot here, page is clean
     ├─ 3. _lockScroll()
     ├─ 4. _drawHighlightFrame(el)
     └─ 5. _showConfirmIcons(el)
                │
                ├─ Accept → _commitStep(el, screenshot)
                └─ Edit   → _rejectElement(el) → back to State 0
```

The screenshot is always of the clean page state — no Ophelia chrome in frame. The highlight frame and icons are rendered *after* the capture.

---

## Updated Guide Data Shape

Additions to the step object defined in `guide-system-roadmap.md`:

```json
{
  "order": 0,
  "action": "click",
  "screenshot": "<base64-jpeg>",
  "fingerprint": {
    "tag": "button",
    "xpath": "...",
    "selector": "...",
    "textContent": "New App",
    "ariaLabel": "Create new application",
    "boundingRect": { "x": 340, "y": 88, "w": 112, "h": 36 }
  },
  "point": { "x": 340, "y": 88 },
  "narration": "Click the blue New App button in the top right.",

  "attempts": 2,
  "excludedElements": [
    {
      "xpath": "//header/nav/div[1]/button[2]",
      "selector": "header nav .menu-btn",
      "tagName": "BUTTON",
      "textContent": "Menu",
      "boundingRect": { "x": 280, "y": 20, "w": 80, "h": 36 },
      "rejectedAt": 1748000100
    }
  ]
}
```

`attempts` is `1` for a clean first-click accept. Every Edit retry increments it.  
`excludedElements` is empty `[]` on a clean accept.  
Both fields are used downstream: `excludedElements` is sent to the Computer Use re-identification API so it can be skipped during playback; `attempts` is logged for guide quality scoring.

---

## Layer Architecture — Code Sketch

Lives inside `_startCreatorRecording()` in `src/content/assistant.js`.

```js
class CreatorLayer {
  constructor() {
    this.active = false;
    this.stepIndex = 0;
    this.currentStep = null;      // step being built
    this.pendingSteps = [];       // committed steps
    this.excludedEls = [];        // fingerprints rejected this round
    this._highlightEl = null;     // current highlight frame DOM node
    this._iconContainer = null;   // accept/edit icon container DOM node
  }

  mount() {
    this.active = true;
    document.addEventListener('mouseover', this._onHover, true);
    document.addEventListener('click', this._onCapture, true);
  }

  unmount() {
    this.active = false;
    document.removeEventListener('mouseover', this._onHover, true);
    document.removeEventListener('click', this._onCapture, true);
    this._clearHighlight();
    this._clearIcons();
    this._unlockScroll();
  }

  _onHover(e) { /* draw/move boundary preview */ }

  async _onCapture(e) {
    e.preventDefault(); e.stopPropagation();
    if (this._isExcluded(e.target)) { this._shakeTarget(e.target); return; }
    const screenshot = await _captureScreen();
    this._lockScroll();
    this._drawHighlightFrame(e.target);
    this._showConfirmIcons(e.target, screenshot);
  }

  _onAccept(el, screenshot) {
    this._commitStep(el, screenshot);
    this._resetRound();
  }

  _onEdit(el) {
    this.excludedEls.push(_fingerprintElement(el));
    this._stampRejected(el);
    this._resetRound(keepExclusions: true);
  }

  _commitStep(el, screenshot) {
    this.pendingSteps.push({
      order: this.stepIndex++,
      action: 'click',
      screenshot,
      fingerprint: _fingerprintElement(el),
      point: _centerOf(el),
      attempts: this.excludedEls.length + 1,
      excludedElements: [...this.excludedEls],
      narration: null  // filled async by Claude
    });
    _fireNarrationAsync(el, screenshot);
  }

  _resetRound(keepExclusions = false) {
    if (!keepExclusions) this.excludedEls = [];
    this._clearHighlight();
    this._clearIcons();
    this._unlockScroll();
  }
}
```

---

## Integration Points with Existing Roadmap

| Roadmap item | How this spec connects |
|---|---|
| Phase 2.1 `_startCreatorRecording()` | Replace click listener with `CreatorLayer.mount()` |
| Phase 2.2 Claude narration | `_fireNarrationAsync()` called inside `_commitStep()` — unchanged |
| Phase 2.3 Visual feedback | Dot label states map directly to the three layer states above |
| Phase 3.2 Step Preview | `excludedElements[]` shown as struck-through thumbnails in preview |
| Phase 4.3 `_reidentifyElement` | Pass `step.excludedElements` to Computer Use API to narrow search |

---

## Open Questions for Next Iteration

- **Multi-element steps** — should the creator be able to accept a *group* (e.g. a form row)? Flag for later.
- **Scroll during State 0** — allow natural page scroll while scanning; `_onCapture` re-calculates `getBoundingClientRect` after scroll settles.
- **Keyboard shortcut** — `Enter` = Accept, `Backspace` = Edit, while confirm icons are visible.
- **Undo last step** — `Ctrl+Z` during recording: pop `pendingSteps[]`, restore previous dot label.
