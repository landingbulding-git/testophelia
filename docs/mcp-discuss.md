# MCP Discussion — Which Servers Fit Ophelia?

> Research notes on candidate MCP integrations, with a verdict for each based on Ophelia's actual architecture constraints.

---

## 1. WebMCP — "The Frontend Specialist"

In 2026, standard MCP is server-side, but WebMCP is the browser-native API (Chrome 146+) that lets a **webpage** expose tools directly to Claude via `navigator.modelContext`.

**The proposed use case:** Instead of Claude guessing where a button is, the extension registers a tool:

```js
// highlight_element(selector, instruction_text)
navigator.modelContext.registerTool('highlight_element', ({ selector, text }) => {
  document.querySelector(selector).classList.add('ophelia-highlight');
});
```

**Why it's appealing:** Claimed 98% task accuracy because it uses the real DOM, not screenshots.

**⚠️ Verdict for Ophelia: ❌ Not applicable.**
WebMCP requires the **target page** to opt in and register tools. Facebook, SoundCloud, and any other third-party site won't do this. A Chrome extension content script cannot expose WebMCP tools to Claude on behalf of another site. Ophelia's existing direct DOM access via content scripts already achieves the same benefit — without requiring page cooperation.

---

## 2. Playwright MCP — "The Visual Brain"

The Playwright MCP server gives Claude the ability to request an **Accessibility Tree snapshot** of a browser tab it controls via Playwright.

**Why it's appealing:** The Accessibility Tree tells Claude exactly which elements are interactive (buttons, inputs, roles, labels) — far better than raw HTML or screenshot analysis.

**⚠️ Verdict for Ophelia: ❌ Playwright itself is not applicable.**
Playwright controls its own separate browser instance. It cannot observe the user's actual tab (logged into Facebook, mid-session). It also requires a local Node.js server — a hard dependency for end users.

**✅ The underlying concept is the most valuable insight in this document.** The Accessibility Tree (ARIA data) is exactly what `_scanPage()` should be producing. Chrome already exposes `element.computedRole`, `element.computedLabel`, `element.ariaExpanded`, `element.ariaDisabled` — no Playwright needed. Implement natively.

---

## 3. Sequential Thinking MCP — "The Tutorial Logic"

Originally from Anthropic, this MCP structures Claude's reasoning before it acts. Instead of generating an action immediately, Claude first produces a chain-of-thought plan.

**Example reasoning:**
> "To set up a Meta Ad: 1. Check login state. 2. Find 'Create' button. 3. Select Campaign Type."

**Why it's appealing:** Prevents hallucinated steps. Ensures the instruction sequence is coherent before any element is highlighted.

**⚠️ Verdict for Ophelia: ❌ External server dependency is a UX non-starter.**
Requiring users to install Node.js + run a local MCP server defeats the "just install the extension" promise.

**✅ The concept maps perfectly to a native Session Planning step.** At session start, one Claude call generates the full ordered step list. Subsequent calls just verify completion and advance the pointer — dramatically cheaper (~75% token cost reduction) and more coherent than re-analyzing from scratch each time.

---

## 4. Chrome DevTools MCP — "The Deep Inspector"

This MCP bridges Claude to the Chrome DevTools Protocol (CDP), allowing it to inspect computed element state, network requests, JavaScript errors, and accessibility properties.

**Example use case:** A "Publish" button is greyed out. Claude uses CDP to inspect the element and finds `aria-disabled="true"` with a parent form that has validation errors → explains: *"The Publish button is disabled because you haven't filled in the required Title field."*

**Why it's appealing:** Explains **why** things are broken, not just what to click next.

**✅ Verdict for Ophelia: ✅ Highest real-world value — but implement natively via `chrome.debugger`.**
Chrome extensions already have full CDP access through the `chrome.debugger` API. No external server needed. Attach → query → detach in < 200ms. Use it as a fallback when an element is found but appears non-interactive.

---

## Summary Table

| Server | Concept Value | Applicable to Ophelia | Best Implementation |
|---|---|---|---|
| **WebMCP** | Low | ❌ Requires page opt-in | Already done via content scripts |
| **Playwright MCP** | High (ARIA tree) | ❌ Wrong browser | Natively: enhance `_scanPage()` with ARIA APIs |
| **Sequential Thinking** | Very High (planning) | ❌ Needs local server | Natively: session planning Claude call at start |
| **Chrome DevTools MCP** | High (deep inspect) | ✅ Via `chrome.debugger` | Natively: SW + debugger API, attach/detach per need |