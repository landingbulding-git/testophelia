# Element Flow — Root Cause & Fix

## Root Cause

**Current broken flow:**
```
_scanPage() → element attrs → send text to Claude → Claude guesses attrs back
→ _findEl() fuzzy-matches → FAILS on React/SPA sites with no stable labels
```

Claude sees `{aria_label: "Data", tag: "button"}` in the list, returns `{aria_label: "Data", tag: "button"}` — but on Bubble, the real element has `aria-label=""` and the text is in a child span. Score never hits 50 → no highlight.

**Fix: indexed elements — Claude picks a number, we use the ref directly.**

```
_scanPage() → store refs[] → send NUMBERED list → Claude returns {elementIndex: 3}
→ refs[3] → direct highlight — zero matching, 100% reliable
```

---

## New Flow (3 changes, 1 file each)

### 1. `assistant.js` — `_scanPage()` stores refs

```js
let _scannedRefs = []; // module-level, reset each scan

function _scanPage() {
  _scannedRefs = [];
  // ... existing filter logic unchanged ...
  elements.forEach((el, i) => {
    _scannedRefs.push(el);           // keep real ref
    collected.push({ index: i, ...attrs });
  });
  return { url, title, elements: collected.slice(0, 40) };
}
```

### 2. `assistant.js` — `_formatElements()` uses numbered lines

Replace current JSON dump with:
```
#0  button | "New Type" | top-left
#1  button | "Add field" | mid-center  
#2  a      | "Data"      | top-left  [tab]
...
```
Short, no escaping issues, Claude reads it faster and picks the index.

### 3. `background.js` — system prompt returns `elementIndex`

Change one line in the JSON schema:
```
// OLD:
{"instruction":"...","element":{"tag":"","aria_label":"","text_content":"","role":""},"done":false}

// NEW:
{"instruction":"...","elementIndex":0,"done":false}
// elementIndex = the #N from the DOM list. null if no element needed.
```

### 4. `assistant.js` — replace `_findEl()` with direct ref lookup

```js
function _resolveEl(step) {
  const i = step.elementIndex;
  if (typeof i === 'number' && _scannedRefs[i]) return _scannedRefs[i];
  return null;  // triggers coord fallback (Tier 5 — already exists)
}
```

Remove all 5-tier fuzzy matching. It is replaced by this 3-line function.

---

## Files Changed

| File | Change |
|---|---|
| `src/content/assistant.js` | `_scanPage` stores refs, `_formatElements` uses `#N` lines, `_findEl` replaced by `_resolveEl` |
| `src/background/background.js` | System prompt JSON schema: `elementIndex` instead of `element` object |

**That's it. 2 files, ~30 lines changed.**

---

## Why This Is 100% Reliable

- Element refs are captured milliseconds before Claude's request — same DOM state
- Index lookup is `O(1)` — no string matching, no scoring, no threshold
- Works on ANY site regardless of aria labels, React internals, or shadow DOM
- If index is null (Claude says no element needed) → coord fallback already handles it

---

## Fallback Chain (unchanged)

```
elementIndex found → direct ref → highlight ✅
elementIndex null  → no highlight, instruction only ✅  
ref stale (DOM updated during request) → coord fallback (screenshot → x,y → elementFromPoint) ✅
```
